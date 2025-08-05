export enum SnaprollActionType {
  Begin,
  Update,
  Draw,
}

export interface SnaprollActionBegin {
  timestamp: number
  type: SnaprollActionType.Begin
}

export interface SnaprollActionUpdate extends Omit<SnaprollActionBegin, 'type'> {
  timestep: number
  type: SnaprollActionType.Update
  updateStep: number
}

export interface SnaprollActionDraw extends Omit<SnaprollActionUpdate, 'index' | 'type'> {
  alpha: number
  type: SnaprollActionType.Draw
}

// eslint-disable-next-line typescript/no-empty-object-type, typescript/no-empty-interface
export interface SnaprollContext {}

export type SnaprollAction = (SnaprollActionBegin | SnaprollActionDraw | SnaprollActionUpdate) &
  SnaprollContext

type SnaprollActionAndContext = Omit<SnaprollContext, 'alpha' | 'timestamp' | 'timestep' | 'type'> &
  Partial<
    { type: SnaprollActionType } & Omit<SnaprollActionBegin, 'type'> &
      Omit<SnaprollActionDraw, 'type'> &
      Omit<SnaprollActionUpdate, 'type'>
  >

export interface SnaprollSubscriptionControls {
  pause: () => void
  resume: () => void
  unsubscribe: () => void
}

export type SnaprollSubscription = (action: SnaprollAction) => boolean | undefined

export interface SnaprollOptions {
  fps: number
  timestep: number
  context?: SnaprollContext
}

interface SnaprollSubscriptionState {
  active: boolean
}

const DEFAULT_TIMESTEP = 1000 / 60

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
function assertIsFPS(input: unknown): asserts input is number | undefined {
  assert(isPositiveNumberOrUndefined(input), '[snaproll] fps must be a positive number')
}
function assertIsTimestep(input: unknown): asserts input is number | undefined {
  assert(isPositiveNumberOrUndefined(input), '[snaproll] timestep must be a positive number')
}

function assertOptions(
  options: Partial<Pick<SnaprollOptions, 'context' | 'fps' | 'timestep'>>,
): asserts options is Partial<Pick<SnaprollOptions, 'context' | 'fps' | 'timestep'>> {
  assertIsFPS(options.fps)
  assertIsTimestep(options.timestep)
  assert(
    options.context === undefined || typeof options.context === 'object',
    '[snaproll] context must be an object or undefined.',
  )
}

const subscriptionActive = (
  subscriptionStateMap: Map<SnaprollSubscription, SnaprollSubscriptionState>,
) => {
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
  context: SnaprollActionAndContext
  frameDelta: number
  frameDeltaTarget: number
  frameDeltaTargetHalf: number
  frameId: number
  state: TypeState
  subscriptions: SnaprollSubscription[]
  subscriptionStateMap: Map<SnaprollSubscription, SnaprollSubscriptionState>
  timestamp: number
  timestep: number
}

const CONTEXT_EMPTY: Record<keyof Required<SnaprollActionAndContext>, undefined> = {
  alpha: undefined,
  timestamp: undefined,
  timestep: undefined,
  type: undefined,
  updateStep: undefined,
}

const createStore = (
  options: { type?: TypeState } & Partial<SnaprollOptions>,
  subscriptions: Array<[SnaprollSubscription, SnaprollSubscriptionState]> = [],
): Store => {
  assertOptions(options)

  // The amount of time (in milliseconds) to simulate each time update()
  // runs
  const timestep = options.timestep ?? DEFAULT_TIMESTEP

  // The cumulative amount of in-app time that hasn't been simulated yet.
  const frameDelta = 0

  // The timestamp in milliseconds of the last time the main loop was run.
  const timestamp = 0

  // The minimum amount of time in milliseconds that must pass since the last
  // frame was executed before another frame can be executed.
  const frameDeltaTarget = 1000 / (options.fps ?? 60)
  const frameDeltaTargetHalf = frameDeltaTarget * 0.5

  const state = options.type ?? TypeState.Paused

  // The ID of the currently executing frame. Used to cancel frames when
  // stopping the loop.
  const frameId = 0

  const context: SnaprollActionAndContext =
    options.context === undefined
      ? { ...CONTEXT_EMPTY }
      : Object.assign(options.context, CONTEXT_EMPTY)

  const activeSubscriptions: SnaprollSubscription[] = []
  const subscriptionStateMap = new Map<SnaprollSubscription, SnaprollSubscriptionState>()

  for (const [subscriptionFunction, subscriptionState] of subscriptions) {
    subscriptionStateMap.set(subscriptionFunction, subscriptionState)
    if (subscriptionState.active) {
      activeSubscriptions.push(subscriptionFunction)
    }
  }

  return {
    context,
    frameDelta,
    frameDeltaTarget,
    frameDeltaTargetHalf,
    frameId,
    state,
    subscriptions: activeSubscriptions,
    subscriptionStateMap,
    timestamp,
    timestep,
  }
}

const createAnimate = (store: Store, callback: () => ReturnType<SnaprollSubscription>) => {
  const context = store.context

  function animate(now: number): void {
    store.frameId = requestAnimationFrame(animate)
    const { frameDeltaTarget, frameDeltaTargetHalf, timestamp, timestep } = store
    const frameTime = now - timestamp

    /* deterministic phase-gate */
    // if (((now / frameDeltaTarget) | 0) === ((timestamp / frameDeltaTarget) | 0)) {
    /* modulo phase resampler */
    if ((now + frameDeltaTargetHalf) % frameDeltaTarget > frameTime) {
      if (__ENVIRONMENT__ !== 'production') {
        performance.mark('snaproll-animate-frame-drop')
      }
      return
    }

    context.type = SnaprollActionType.Begin
    context.timestamp = now

    if (callback() === true) {
      if (__ENVIRONMENT__ !== 'production') {
        performance.mark('snaproll-animate-frame-drop')
      }
      return
    }

    store.frameDelta += frameTime
    store.timestamp = now

    context.type = SnaprollActionType.Update
    context.timestep = timestep

    const updateSteps = (store.frameDelta / timestep) | 0

    for (let index = updateSteps; index > 0; index--) {
      context.updateStep = index

      if (callback() === true) {
        if (__ENVIRONMENT__ !== 'production') {
          performance.mark('snaproll-animate-frame-drop')
        }

        store.frameDelta = 0
        return
      }

      store.frameDelta -= timestep
    }

    context.type = SnaprollActionType.Draw
    context.alpha = store.frameDelta / timestep
    callback()
  }

  return animate
}

export class Snaproll {
  private readonly callback = (): ReturnType<SnaprollSubscription> => {
    const { context, subscriptions: activeSubscriptions } = this.store
    const length = activeSubscriptions.length
    const action = context

    let state: ReturnType<SnaprollSubscription> = undefined

    for (let index = 0; index < length; index++) {
      const subscription = activeSubscriptions[index]

      if (subscription(action as SnaprollAction) === true) {
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

  public idle() {
    const store = this.store

    if (store.state !== TypeState.Active || subscriptionActive(store.subscriptionStateMap)) {
      return
    }

    cancelAnimationFrame(store.frameId)
    store.state = TypeState.Idle
  }

  public pause() {
    const store = this.store

    if (store.state === TypeState.Paused) {
      return
    }

    if (store.state === TypeState.Active) {
      cancelAnimationFrame(store.frameId)
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

    // preserve the options
    this.store = createStore(
      {
        fps: options.fps ?? 1000 / previousStore.frameDeltaTarget,
        timestep: options.timestep ?? previousStore.timestep,
        type: previousStore.state,
        /**
         * Determines the context to use
         *
         * @remarks
         * The context resolution follows these rules:
         * - If keepContext=true and hasContext=true: Merges new context with existing store context
         * - If keepContext=false and hasContext=true: Uses only the provided new context
         * - If keepContext=true and hasContext=false: Uses only the existing store context
         * - If keepContext=false and hasContext=false: No context (undefined)
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
      },
      keepSubscriptions ? Array.from(previousStore.subscriptionStateMap.entries()) : undefined,
    )
  }

  public resume() {
    const store = this.store

    if (store.state === TypeState.Active) {
      return
    }

    store.state = subscriptionActive(store.subscriptionStateMap) ? TypeState.Active : TypeState.Idle

    if (store.state === TypeState.Active) {
      store.frameId = requestAnimationFrame((timestamp) => {
        store.frameDelta = 0
        store.timestamp = timestamp
        store.frameId = requestAnimationFrame(createAnimate(store, this.callback))
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

  public get fps() {
    return 1000 / this.store.frameDeltaTarget
  }

  public set fps(value: number) {
    assertIsFPS(value)

    this.store.frameDeltaTarget = 1000 / value
    this.store.frameDeltaTargetHalf = this.store.frameDeltaTarget * 0.5
  }

  public get state() {
    return STATES[this.store.state]
  }

  public get timestep() {
    return this.store.timestep
  }

  public set timestep(value: number) {
    assertIsTimestep(value)

    this.store.timestep = value
  }
}
