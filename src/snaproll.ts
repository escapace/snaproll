import type { SnaprollUserContext } from './index'
import { assert } from './utilities/assert'
import { isPositiveNumberOrUndefined } from './utilities/is-positive-number-or-undefined'
/**
 * Animation frame phases.
 */
export enum SnaprollActionType {
  Begin,
  Update,
  Draw,
}

/**
 * Frame initialization action.
 */
export interface SnaprollActionBegin {
  action: SnaprollActionType.Begin
  /** Current frame time */
  timestamp: number
}

/**
 * Fixed timestep animation logic action.
 * The updateStep counts down remaining updates in the current frame.
 */
export interface SnaprollActionUpdate extends Omit<SnaprollActionBegin, 'action'> {
  action: SnaprollActionType.Update
  /** Time to advance per update */
  timestep: number
  /** Remaining updates this frame, counts down to 1 */
  updateStep: number
}

/**
 * Interpolated drawing action.
 */
export interface SnaprollActionDraw extends Omit<SnaprollActionUpdate, 'action'> {
  action: SnaprollActionType.Draw
  /** Interpolation factor [0, 1) */
  alpha: number
}

/**
 * Context object passed to subscription callbacks during animation frames.
 *
 * @remarks
 * Discriminated union that combines action-specific interfaces with user context.
 * Available properties depend on the current action type: Begin, Update, or Draw.
 */
export type SnaprollContext = (SnaprollActionBegin | SnaprollActionDraw | SnaprollActionUpdate) &
  SnaprollUserContext

/**
 * Control interface for managing individual animation subscriptions.
 *
 * @remarks
 * Each subscription operates independently. Pausing one subscription does not affect others.
 * The animation loop continues running as long as any subscription remains active.
 */
export interface SnaprollSubscriptionControls {
  /** Pauses this subscription */
  pause: () => void
  /** Resumes this subscription */
  resume: () => void
  /** Removes this subscription */
  unsubscribe: () => void
}

/**
 * Subscription callback function.
 *
 * @remarks
 * Return value controls frame execution flow:
 * - `true` from Begin phase skips the entire frame
 * - `true` from Update phase skips remaining updates and draw for current frame
 * - `undefined` or `false` continues normal execution
 */
export type SnaprollSubscription = (context: SnaprollContext) => boolean | undefined

/**
 * Configuration interface for animation loop.
 *
 * @remarks
 * drawRate and updateRate operate independently, allowing different frequencies
 * for draw and update rates.
 */
export interface SnaprollOptions {
  /** Draw rate in Hz, controls visual frame timing */
  drawRate: number
  /** Update rate in Hz, determines fixed timestep size */
  updateRate: number
  /** Optional shared state object passed to all subscription callbacks */
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
/**
 * Dead-zone half-width for the phase detector. Half-width of the dead-zone. Using (0.5 - EPS) makes
 * the effective thresholds symmetric at ±(0.5 + EPS) after truncation (see `k` below). EPS is a
 * tiny epsilon to keep decisions stable at the ±0.5 boundaries despite FP noise. Chosen small
 * enough not to matter visually, big enough to break ties deterministically.
 *
 * In plain terms: if we're only about half a frame early/late, we treat it as “close enough”
 * and do nothing. We only jump a frame when the error is bigger than ~0.5 + EPS frames.
 *
 * EPS options:
 * - Number.EPSILON / 2 — tie-break only. No real buffer; great if timing is rock-solid.
 * - 1e-3 — small buffer (~0.001 frames ≈ 16.7 µs at 60 Hz). Calms tiny jitter with no visible lag.
 * - 3e-3 — balanced: ~0.003 frames ≈ 50 µs at 60 Hz. Steadier without feeling sluggish.
 * - 1e-2 — stronger buffer (~0.01 frames ≈ 0.167 ms at 60 Hz). Best for noisy threads; slightly less snappy.
 *
 * Notes:
 * - This doesn’t change the average frame rate; it only smooths “step now vs next tick” decisions.
 * - Thresholds are symmetric around ±0.5, so there’s no bias toward stepping early or late.
 */
const DEAD_ZONE_HALF_WIDTH = 0.5 - 3e-3 // 3e-3

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
  pendingAnimationFrame: number
  pendingTime: number
  quantizationAlphaMax: number
  quantizationGrid: number
  quantizationGridInverse: number
  state: TypeState
  subscriptions: SnaprollSubscription[]
  subscriptionStateMap: Map<SnaprollSubscription, SubscriptionState>
  targetFrameTime: number
  targetTimestamp: number
  timestamp: number
  timestep: number
  timestepInverse: number
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

  const targetTimestamp = 0
  const pendingTime = 0

  return {
    context,
    pendingAnimationFrame,
    pendingTime,
    state,
    subscriptions,
    subscriptionStateMap,
    targetTimestamp,
    timestamp,
    ...createDrawRateStorePartial(drawRate),
    ...createUpdateRateStorePartial(updateRate),
  }
}

const createUpdateRateStorePartial = (
  updateRate: number,
): Pick<Store, 'timestep' | 'timestepInverse' | 'updateRate'> => {
  const timestep = 1000 / updateRate
  const timestepInverse = 1 / timestep

  return {
    timestep,
    timestepInverse,
    updateRate,
  }
}

const createDrawRateStorePartial = (
  drawRate: number,
): Pick<
  Store,
  | 'drawRate'
  | 'quantizationAlphaMax'
  | 'quantizationGrid'
  | 'quantizationGridInverse'
  | 'targetFrameTime'
> => {
  const quantizationGrid = 1 << Math.ceil(Math.log2(drawRate * 2))
  const quantizationGridMask = quantizationGrid - 1
  const quantizationGridInverse = 1 / quantizationGrid
  const quantizationAlphaMax = quantizationGridMask * quantizationGridInverse
  const targetFrameTime = 1000 / drawRate

  return {
    drawRate,
    quantizationAlphaMax,
    quantizationGrid,
    quantizationGridInverse,
    targetFrameTime,
  }
}

const createAnimate = (store: Store, callback: () => ReturnType<SnaprollSubscription>) => {
  const context = store.context

  function animate(): void {
    store.pendingAnimationFrame = requestAnimationFrame(animate)
    const now = performance.now()

    const { targetFrameTime, targetTimestamp } = store

    // Phase error in *target-frame units*: how far `now` is from the scheduled target.
    // e > 0 → we're *late* (now is after the target), e < 0 → we're *early*.
    const phaseError = (now - targetTimestamp) / targetFrameTime
    // Integer number of target periods to advance (k > 0) or slip back (k < 0).
    // Implementation: add/subtract `half` then truncate toward zero via `| 0` (32-bit).
    // This acts as an unbiased bang-bang phase detector:
    //   if   e ≥  +0.5 + EPS  → k ≥ +1  (step forward)
    //   if  -0.5 - EPS < e < +0.5 + EPS → k = 0   (within dead-zone; no step)
    //   if   e ≤  -0.5 - EPS  → k ≤ −1  (step backward)
    // Notes:
    // - `| 0` is equivalent to Math.trunc for finite numbers and is safe here since k ∈ {…,−1,0,+1,…}.
    // - The symmetric ±(0.5+EPS) thresholds eliminate tie bias at +0.5 vs −0.5.
    //
    // Conditional expression approach (slightly slower)
    // const k =
    //   (phaseError >= 0 ? phaseError + DEAD_ZONE_HALF_WIDTH : phaseError - DEAD_ZONE_HALF_WIDTH) | 0
    // Alternative manual sign calculation approach (equivalent performance)
    // const s = +(phaseError > 0) - +(phaseError < 0) // 1, 0, or -1 without branching
    // const k = (phaseError + s * DEAD_ZONE_HALF_WIDTH) | 0
    // Use Math.sign() for dead zone adjustment: single-line implementation with
    // well-understood built-in function provides slight better performance.
    const k = (phaseError + Math.sign(phaseError) * DEAD_ZONE_HALF_WIDTH) | 0

    // If no step is needed, we're still inside the dead-zone, so skip work this tick.
    if (k === 0) {
      if (__ENVIRONMENT__ !== 'production') {
        performance.mark('snaproll-animate-frame-drop')
      }
      return
    }

    // Apply the decided step: move the digital controlled clock (DCO) by k periods.
    // This re-centers residual phase r = (now - targetTimestamp)/T into (−0.5, +0.5),
    // keeping the loop locked while decimating rAF to your target cadence.
    store.targetTimestamp = targetTimestamp + k * targetFrameTime

    context.action = SnaprollActionType.Begin
    context.timestamp = now

    if (callback() === true) {
      if (__ENVIRONMENT__ !== 'production') {
        performance.mark('snaproll-animate-frame-drop')
      }
      return
    }

    let pendingTime = store.pendingTime
    const deltaTime = now - store.timestamp
    pendingTime += deltaTime
    store.timestamp = now

    const timestep = (context.timestep = store.timestep)
    context.action = SnaprollActionType.Update
    const timestepInverse = store.timestepInverse

    let updateStep = (pendingTime * timestepInverse) | 0

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
    const alpha = pendingTime * timestepInverse
    // store.quantizationGrid = 1 << Math.ceil(Math.log2(drawRate * 2))
    // store.quantizationGridMask = quantizationGrid - 1
    // store.quantizationGridInverse = 1 / quantizationGrid
    // store.quantizationAlphaMax = quantizationGridMask * quantizationGridInverse
    const { quantizationAlphaMax, quantizationGrid, quantizationGridInverse } = store
    const quantizedAlpha = ((alpha * quantizationGrid + 0.5) | 0) * quantizationGridInverse
    context.alpha = quantizedAlpha < 1 ? quantizedAlpha : quantizationAlphaMax

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

/**
 * Fixed-timestep animation loop with independent draw and update rates.
 */
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

  /**
   * Creates animation loop instance with specified configuration.
   */
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

  /**
   * Stops animation while keeping subscriptions.
   */
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

  /**
   * Resets the animation loop with optional configuration updates.
   */
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
          ? Object.assign(options.context!, this.store.context)
          : hasContext
            ? options.context!
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

  /**
   * Resumes animation.
   */
  public resume() {
    const store = this.store

    if (store.state === TypeState.Active) {
      return
    }

    store.state = subscriptionActive(store.subscriptionStateMap) ? TypeState.Active : TypeState.Idle

    if (store.state === TypeState.Active) {
      store.pendingAnimationFrame = requestAnimationFrame(() => {
        const now = performance.now()
        store.pendingTime = 0
        store.timestamp = now
        store.targetTimestamp = now
        store.pendingAnimationFrame = requestAnimationFrame(createAnimate(store, this.callback))
      })
    }
  }

  /**
   * Registers subscription callback for animation frame processing.
   *
   * @param value - Callback function to execute during frame processing
   * @param options - Subscription configuration with immediate activation flag
   * @returns Control object for pausing, resuming, and removing subscription
   */
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

  /**
   * Current animation loop state.
   *
   * Returns 'active' when running animation frames, 'idle' when no active subscriptions,
   * or 'paused' when stopped by pause().
   */
  public get state() {
    return STATES[this.store.state]
  }

  /**
   * Gets current update rate in Hz.
   */
  public get updateRate() {
    return this.store.updateRate
  }

  /**
   * Sets update rate in Hz.
   */
  public set updateRate(value: number) {
    assertIsUpdateRate(value)

    Object.assign(this.store, createUpdateRateStorePartial(value))
  }

  /**
   * Gets current draw rate in Hz.
   */
  public get drawRate() {
    return this.store.drawRate
  }

  /**
   * Sets draw rate in Hz.
   */
  public set drawRate(value: number) {
    assertIsDrawRate(value)

    Object.assign(this.store, createDrawRateStorePartial(value))
  }
}
