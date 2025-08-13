export enum SnaprollActionType {
  Begin,
  Update,
  Draw,
}

export interface SnaprollActionBegin {
  action: SnaprollActionType.Begin
  timestamp: number
}

export interface SnaprollActionUpdate extends Omit<SnaprollActionBegin, 'action'> {
  action: SnaprollActionType.Update
  timestep: number
  updateStep: number
}

export interface SnaprollActionDraw extends Omit<SnaprollActionUpdate, 'action'> {
  action: SnaprollActionType.Draw
  alpha: number
}

// eslint-disable-next-line typescript/no-empty-object-type, typescript/no-empty-interface
export interface SnaprollUserContext {}

export type SnaprollContext = (SnaprollActionBegin | SnaprollActionDraw | SnaprollActionUpdate) &
  SnaprollUserContext

export interface SnaprollSubscriptionControls {
  pause: () => void
  resume: () => void
  unsubscribe: () => void
}

export type SnaprollSubscription = (context: SnaprollContext) => boolean | undefined

export interface SnaprollOptions {
  drawRate: number
  updateRate: number
  context?: SnaprollUserContext
}

interface SubscriptionState {
  active: boolean
}

type Context = Omit<SnaprollUserContext, 'action' | 'alpha' | 'timestamp' | 'timestep'> &
  Partial<
    { action: SnaprollActionType } & Omit<SnaprollActionBegin, 'action'> &
      Omit<SnaprollActionDraw, 'action'> &
      Omit<SnaprollActionUpdate, 'action'>
  >

const DEFAULT_UPDATE_RATE = 60
const DEFAULT_DRAW_RATE = 60

const isPositiveNumber = (input: unknown): input is number =>
  typeof input === 'number' && input > 0 && Number.isFinite(input)

const isUndefined = (input: unknown): input is undefined => input === undefined

const isPositiveNumberOrUndefined = (input: unknown): input is number | undefined =>
  isPositiveNumber(input) || isUndefined(input)

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}
function assertIsDrawRate(input: unknown): asserts input is number | undefined {
  assert(isPositiveNumberOrUndefined(input), '[snaproll] draw rate must be a positive number')
}
function assertIsUpdateRate(input: unknown): asserts input is number | undefined {
  assert(isPositiveNumberOrUndefined(input), '[snaproll] timestep must be a positive number')
}

function assertOptions(
  options: Partial<Pick<SnaprollOptions, 'context' | 'drawRate' | 'updateRate'>>,
): asserts options is Partial<Pick<SnaprollOptions, 'context' | 'drawRate' | 'updateRate'>> {
  assertIsDrawRate(options.drawRate)
  assertIsUpdateRate(options.updateRate)
  assert(
    options.context === undefined || typeof options.context === 'object',
    '[snaproll] context must be an object or undefined.',
  )
}

const subscriptionActive = (subscriptionStateMap: Map<SnaprollSubscription, SubscriptionState>) => {
  for (const state of subscriptionStateMap.values()) {
    if (state.active) {
      return true
    }
  }
  return false
}

const enum TypeState {
  Active = 0,
  Idle = 1,
  Paused = 2,
}

const STATES = {
  [TypeState.Active]: 'active',
  [TypeState.Idle]: 'idle',
  [TypeState.Paused]: 'paused',
} as const

interface Store {
  context: Context
  drawRate: number
  frameIndex: number
  pendingAnimationFrame: number
  pendingTime: number
  quantizationGrid: number
  state: TypeState
  subscriptions: SnaprollSubscription[]
  subscriptionStateMap: Map<SnaprollSubscription, SubscriptionState>
  targetFrameTime: number
  timestamp: number
  timestep: number
  updateRate: number
}

const CONTEXT_EMPTY: Record<keyof Required<Context>, undefined> = {
  action: undefined,
  alpha: undefined,
  timestamp: undefined,
  timestep: undefined,
  updateStep: undefined,
}

const createStore = (
  options: Partial<
    { subscriptions: Array<[SnaprollSubscription, SubscriptionState]> } & Pick<Store, 'state'> &
      SnaprollOptions
  >,
  // previous = [],
): Store => {
  assertOptions(options)

  // The amount of time (in milliseconds) to simulate each time update()
  // runs
  const updateRate = options.updateRate ?? DEFAULT_UPDATE_RATE

  // The timestamp in milliseconds of the last time the main loop was run.
  const timestamp = 0

  // The minimum amount of time in milliseconds that must pass since the last
  // frame was executed before another frame can be executed.
  const drawRate = options.drawRate ?? DEFAULT_DRAW_RATE

  const state = options.state ?? TypeState.Paused

  // The ID of the currently executing frame. Used to cancel frames when
  // stopping the loop.
  const pendingAnimationFrame = 0

  const context: Context =
    options.context === undefined
      ? { ...CONTEXT_EMPTY }
      : Object.assign(options.context, CONTEXT_EMPTY)

  const subscriptions: SnaprollSubscription[] = []
  const subscriptionStateMap = new Map<SnaprollSubscription, SubscriptionState>()

  if (options.subscriptions !== undefined) {
    for (const [subscriptionFunction, subscriptionState] of options.subscriptions) {
      subscriptionStateMap.set(subscriptionFunction, subscriptionState)
      if (subscriptionState.active) {
        subscriptions.push(subscriptionFunction)
      }
    }
  }

  const frameIndex = 0
  const pendingTime = 0

  return {
    context,
    frameIndex,
    pendingAnimationFrame,
    pendingTime,
    state,
    subscriptions,
    subscriptionStateMap,
    timestamp,
    ...createDrawRateStorePartial(drawRate),
    ...createUpdateRateStorePartial(updateRate),
  }
}

const createUpdateRateStorePartial = (
  updateRate: number,
): Pick<Store, 'timestep' | 'updateRate'> => {
  const timestep = 1000 / updateRate

  return {
    timestep,
    updateRate,
  }
}

const createDrawRateStorePartial = (
  drawRate: number,
): Pick<Store, 'drawRate' | 'quantizationGrid' | 'targetFrameTime'> => {
  /**
   * Power-of-two temporal quantization lattice for interpolation discretization.
   *
   * @remarks
   * Applied via: floor(value * GRID) / GRID
   */
  const quantizationGrid = 1 << Math.ceil(Math.log2(drawRate))
  const targetFrameTime = 1000 / drawRate

  return {
    drawRate,
    quantizationGrid,
    targetFrameTime,
  }
}

const createAnimate = (store: Store, callback: () => ReturnType<SnaprollSubscription>) => {
  const context = store.context

  function animate(now: number): void {
    store.pendingAnimationFrame = requestAnimationFrame(animate)
    const frameIndex = (now / store.targetFrameTime) | 0

    // /* modulo phase resampler */
    // if ((now + targetFrameTime * 0.5) % targetFrameTime > deltaTime) {
    /* deterministic phase-gate */
    if (frameIndex === store.frameIndex) {
      if (__ENVIRONMENT__ !== 'production') {
        performance.mark('snaproll-animate-frame-drop')
      }
      return
    }

    store.frameIndex = frameIndex
    context.action = SnaprollActionType.Begin
    context.timestamp = now

    if (callback() === true) {
      if (__ENVIRONMENT__ !== 'production') {
        performance.mark('snaproll-animate-frame-drop')
      }
      return
    }

    const deltaTime = now - store.timestamp
    let pendingTime = store.pendingTime + deltaTime
    store.timestamp = now

    const timestep = store.timestep
    context.action = SnaprollActionType.Update
    context.timestep = timestep

    let updateStep = (pendingTime / timestep) | 0

    while (updateStep > 0) {
      context.updateStep = updateStep

      if (callback() === true) {
        if (__ENVIRONMENT__ !== 'production') {
          performance.mark('snaproll-animate-frame-drop')
        }

        store.pendingTime = 0
        return
      }

      pendingTime -= timestep
      updateStep--
    }

    store.pendingTime = pendingTime
    context.action = SnaprollActionType.Draw
    /**
     * quantizationGrid is a user set temporal frequency in hertz, same as frames per
     * second. (60 by default)
     */
    const quantizationGrid = store.quantizationGrid
    const alpha = pendingTime / timestep
    context.alpha = ((alpha * quantizationGrid) | 0) / quantizationGrid
    callback()

    if (__ENVIRONMENT__ !== 'production') {
      const interpolationAlphaJitter = (context.alpha - alpha) * timestep

      performance.mark('snaproll-animate-frame-jitter', {
        detail: { deltaTime, interpolationAlphaJitter, quantizationGrid },
      })
    }
  }

  return animate
}

export class Snaproll {
  private readonly callback = (): ReturnType<SnaprollSubscription> => {
    const { context, subscriptions: activeSubscriptions } = this.store
    const length = activeSubscriptions.length

    let state: ReturnType<SnaprollSubscription> = undefined

    for (let index = 0; index < length; index++) {
      const subscription = activeSubscriptions[index]

      if (subscription(context as SnaprollContext) === true) {
        state = true
      }
    }

    return state
  }

  /**
   * Rebuilds the active subscriptions array from the subscription state map.
   *
   * @remarks
   * Map preserves insertion order, ensuring subscriptions are processed in the order they were added.
   */
  private updateSubscriptions(): void {
    this.store.subscriptions.length = 0
    for (const [subscription, state] of this.store.subscriptionStateMap) {
      if (state.active) {
        this.store.subscriptions.push(subscription)
      }
    }
  }

  private store: Store

  constructor(options: Partial<SnaprollOptions> = {}) {
    this.store = createStore(options)
  }

  private idle() {
    const store = this.store

    if (store.state !== TypeState.Active || subscriptionActive(store.subscriptionStateMap)) {
      return
    }

    cancelAnimationFrame(store.pendingAnimationFrame)
    store.state = TypeState.Idle
  }

  public pause() {
    const store = this.store

    if (store.state === TypeState.Paused) {
      return
    }

    if (store.state === TypeState.Active) {
      cancelAnimationFrame(store.pendingAnimationFrame)
    }

    store.state = TypeState.Paused
  }

  public reset(
    options: { keepContext?: boolean; keepSubscriptions?: boolean } & Partial<SnaprollOptions> = {},
  ) {
    const previousStore = this.store
    const keepSubscriptions = options?.keepSubscriptions !== false
    const keepContext = options?.keepContext !== false
    const hasContext = options?.context !== undefined

    const previousState = previousStore.state

    this.pause()

    // preserve the options
    this.store = createStore({
      drawRate: options.drawRate ?? previousStore.drawRate,
      updateRate: options.updateRate ?? previousStore.updateRate,
      /**
       * Determines the context to use
       *
       * @remarks
       * The context resolution follows these rules:
       * - If keepContext=true and hasContext=true: Uses provided context object, assigns existing store context to provided context object
       * - If keepContext=false and hasContext=true: Uses the provided context object
       * - If keepContext=true and hasContext=false: Uses the existing context object
       * - If keepContext=false and hasContext=false: Uses a new empty context object
       */
      context:
        keepContext && hasContext
          ? // eslint-disable-next-line typescript/no-non-null-assertion
            Object.assign(options.context!, this.store.context)
          : hasContext
            ? // eslint-disable-next-line typescript/no-non-null-assertion
              options.context!
            : keepContext
              ? this.store.context
              : undefined,
      subscriptions: keepSubscriptions
        ? Array.from(previousStore.subscriptionStateMap.entries())
        : undefined,
    })

    if (previousState !== TypeState.Paused) {
      this.resume()
    }
  }

  public resume() {
    const store = this.store

    if (store.state === TypeState.Active) {
      return
    }

    store.state = subscriptionActive(store.subscriptionStateMap) ? TypeState.Active : TypeState.Idle

    if (store.state === TypeState.Active) {
      store.pendingAnimationFrame = requestAnimationFrame((now) => {
        store.pendingTime = 0
        store.timestamp = now
        store.frameIndex = (now / store.targetFrameTime) | 0
        store.pendingAnimationFrame = requestAnimationFrame(createAnimate(store, this.callback))
      })
    }
  }

  public subscribe(
    value: SnaprollSubscription,
    options?: { immediate?: boolean },
  ): SnaprollSubscriptionControls {
    let subscriptionState = this.store.subscriptionStateMap.get(value)

    if (subscriptionState === undefined) {
      const active = options?.immediate !== false
      subscriptionState = { active }

      this.store.subscriptionStateMap.set(value, subscriptionState)
      this.updateSubscriptions()

      if (this.store.state === TypeState.Idle) {
        this.resume()
      }
    }

    return {
      pause: () => {
        if (subscriptionState === undefined) {
          return
        }

        subscriptionState.active = false
        this.updateSubscriptions()
        this.idle()
      },
      resume: () => {
        if (subscriptionState === undefined) {
          return
        }

        subscriptionState.active = true
        this.updateSubscriptions()

        if (this.store.state === TypeState.Idle) {
          this.resume()
        }
      },
      unsubscribe: () => {
        if (subscriptionState === undefined) {
          return
        }

        subscriptionState = undefined
        this.store.subscriptionStateMap.delete(value)
        this.updateSubscriptions()
        this.idle()
      },
    }
  }

  public get state() {
    return STATES[this.store.state]
  }

  public get updateRate() {
    return this.store.updateRate
  }

  public set updateRate(value: number) {
    assertIsUpdateRate(value)

    Object.assign(this.store, createUpdateRateStorePartial(value))
  }

  public get drawRate() {
    return this.store.drawRate
  }

  public set drawRate(value: number) {
    assertIsDrawRate(value)

    Object.assign(this.store, createDrawRateStorePartial(value))
  }
}
