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
}

export interface SnaprollActionDraw extends Omit<SnaprollActionUpdate, 'type'> {
  delta: number
  type: SnaprollActionType.Draw
}

export type SnaprollAction = SnaprollActionBegin | SnaprollActionDraw | SnaprollActionUpdate

type SnaprollAction_ = Partial<
  { type: SnaprollActionType } & Omit<SnaprollActionBegin, 'type'> &
    Omit<SnaprollActionDraw, 'type'> &
    Omit<SnaprollActionUpdate, 'type'>
>

export interface SnaprollSubscriptionControls {
  pause: () => void
  resume: () => void
  unsubscribe: () => void
}

export type SnaprollSubscription = (action: SnaprollAction) => void

export interface SnaprollOptions {
  fps: number
  timestep: number
}

interface SnaprollSubscriptionState {
  active: boolean
  value: SnaprollSubscription
}

const DEFAULT_TIMESTEP = 1000 / 60
const FRAME_DELTA_EMA_ALPHA = 0.1
const FRAME_DELTA_EMA_ALPHA_REVERSE = 0.9

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
  assert(isPositiveNumberOrUndefined(input), '[seedpods] fps must be a positive number')
}
function assertIsTimestep(input: unknown): asserts input is number | undefined {
  assert(isPositiveNumberOrUndefined(input), '[seedpods] timestep must be a positive number')
}

function assertOptions(
  options: Partial<Pick<SnaprollOptions, 'fps' | 'timestep'>>,
): asserts options is Partial<Pick<SnaprollOptions, 'fps' | 'timestep'>> {
  assertIsFPS(options.fps)
  assertIsTimestep(options.timestep)
}

const subscriptionRemove = (
  subscription: SnaprollSubscription,
  subscriptions: SnaprollSubscriptionState[],
): SnaprollSubscriptionState[] => subscriptions.filter((element) => element.value !== subscription)

const subscriptionFind = (
  subscription: SnaprollSubscription,
  subscriptions: SnaprollSubscriptionState[],
) => subscriptions.find((element) => element.value === subscription)

const subscriptionActive = (subscriptions: SnaprollSubscriptionState[]) =>
  subscriptions.some((element) => element.active)

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
  frameDelta: number
  frameDeltaEMA: number
  frameDeltaMin: number
  frameId: number
  pool: SnaprollAction_
  state: TypeState
  subscriptions: SnaprollSubscriptionState[]
  timestampLast: number
  timestep: number
}

const createStore = (
  options: { type?: TypeState } & Partial<SnaprollOptions>,
  subscriptions: SnaprollSubscriptionState[] = [],
): Store => {
  assertOptions(options)

  // An exponential moving average of the frames per second.
  const frameDeltaEMA = 1000

  // The amount of time (in milliseconds) to simulate each time update()
  // runs
  const timestep = options.timestep ?? DEFAULT_TIMESTEP

  // The cumulative amount of in-app time that hasn't been simulated yet.
  const frameDelta = 0

  // The timestamp in milliseconds of the last time the main loop was run.
  const timestampLast = 0

  // The timestamp (in milliseconds) of the last time the `fps` moving
  // average was updated.
  // const frameDeltaEMALastUpdate = 0

  // The number of frames delivered since the last time the `fps` moving
  // average was updated (i.e. since `lastFpsUpdate`).
  // const frameDeltaEMAFramesSinceLastUpdate = 0

  // The minimum amount of time in milliseconds that must pass since the last
  // frame was executed before another frame can be executed.
  const frameDeltaMin = 1000 / (options.fps ?? 60)

  const state = options.type ?? TypeState.Paused

  // The ID of the currently executing frame. Used to cancel frames when
  // stopping the loop.
  const frameId = 0

  const pool: SnaprollAction_ = {
    delta: undefined,
    timestamp: undefined,
    timestep: undefined,
    type: undefined,
  }

  return {
    frameDelta,
    frameDeltaEMA,
    // frameDeltaEMAFramesSinceLastUpdate,
    // frameDeltaEMALastUpdate,
    frameDeltaMin,
    frameId,
    pool,
    state,
    subscriptions,
    timestampLast,
    timestep,
  }
}

const createAnimate = (store: Store, callback: () => void) => {
  const pool = store.pool

  function animate(timestamp: number) {
    store.frameId = requestAnimationFrame(animate)
    const { frameDeltaEMA, frameDeltaMin, timestampLast, timestep } = store
    const frameDelta = timestamp - timestampLast
    const frameDeltaDeviation = Math.max(0, frameDeltaMin - frameDelta) / frameDeltaEMA

    if (timestampLast + frameDeltaDeviation * frameDeltaMin > timestamp) {
      return
    }

    if (__ENVIRONMENT__ !== 'production') {
      performance.mark('snaproll-animate-start')
    }

    store.frameDeltaEMA =
      1 / (FRAME_DELTA_EMA_ALPHA / frameDelta + FRAME_DELTA_EMA_ALPHA_REVERSE / frameDeltaEMA)

    store.frameDelta += frameDelta
    store.timestampLast = timestamp

    pool.type = SnaprollActionType.Begin
    pool.timestamp = timestamp

    callback()

    while (store.frameDelta >= timestep) {
      pool.type = SnaprollActionType.Update
      pool.timestep = timestep
      callback()

      store.frameDelta -= timestep
    }

    pool.type = SnaprollActionType.Draw
    pool.delta = store.frameDelta
    callback()

    if (__ENVIRONMENT__ !== 'production') {
      performance.measure('snaproll-animate', {
        end: performance.now(),
        start: 'snaproll-animate-start',
      })
    }
  }

  return animate
}

// const frameDeltaEMAUpdateInterval = 300
// if (timestamp > state.frameDeltaEMALastUpdate + frameDeltaEMAUpdateInterval) {
//   state.frameDeltaEMA =
//     1 /
//     ((frameDeltaEMAAlpha * state.frameDeltaEMAFramesSinceLastUpdate) /
//       (timestamp - state.frameDeltaEMALastUpdate) +
//       (1 - frameDeltaEMAAlpha) / state.frameDeltaEMA)
//
//   state.frameDeltaEMALastUpdate = timestamp
//   state.frameDeltaEMAFramesSinceLastUpdate = 0
// }
// state.frameDeltaEMAFramesSinceLastUpdate++

export class Snaproll {
  private readonly callback = () => {
    const reference = this.store.subscriptions
    const length = reference.length
    const action = this.store.pool

    for (let index = 0; index < length; index++) {
      const subscription = reference[index]

      if (subscription.active) {
        subscription.value(action as SnaprollAction)
      }
    }
  }

  private store: Store

  constructor(options: Partial<SnaprollOptions> = {}) {
    this.store = createStore(options)
  }

  private idle() {
    const store = this.store

    if (store.state !== TypeState.Active || subscriptionActive(store.subscriptions)) {
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

  public reset(options: { keepSubscriptions?: boolean } & Partial<SnaprollOptions> = {}) {
    const previousStore = this.store
    const keepSubscriptions = options?.keepSubscriptions !== false

    // preserve the options
    this.store = createStore(
      {
        fps: options.fps ?? previousStore.frameDeltaEMA,
        timestep: options.timestep ?? previousStore.timestep,
        type: previousStore.state,
      },
      keepSubscriptions ? [...previousStore.subscriptions] : undefined,
    )
  }

  public resetFrameDelta() {
    const oldFrameDelta = this.store.frameDelta
    this.store.frameDelta = 0

    // The cumulative amount of elapsed time in milliseconds that has not yet
    // been simulated, but is being discarded as a result of calling this
    // function.
    return oldFrameDelta
  }

  public resume() {
    const store = this.store

    if (store.state === TypeState.Active) {
      return
    }

    store.state = subscriptionActive(store.subscriptions) ? TypeState.Active : TypeState.Idle

    if (store.state === TypeState.Active) {
      store.frameId = requestAnimationFrame((timestamp) => {
        store.timestampLast = timestamp
        // state.frameDeltaEMALastUpdate = timestamp
        // state.frameDeltaEMAFramesSinceLastUpdate = 0

        store.frameId = requestAnimationFrame(createAnimate(store, this.callback))
      })
    }
  }

  public subscribe(
    value: SnaprollSubscription,
    options?: { activate?: boolean },
  ): SnaprollSubscriptionControls {
    // eslint-disable-next-line typescript/no-this-alias
    const self = this
    const state = self.store

    if (subscriptionFind(value, state.subscriptions) === undefined) {
      const reference = state.subscriptions
      const active = options?.activate !== false
      state.subscriptions = [...reference, { active, value }]

      if (state.state === TypeState.Idle) {
        self.resume()
      }
    }

    return {
      pause() {
        const subscriptions = state.subscriptions
        const subscription = subscriptionFind(value, subscriptions)

        if (subscription === undefined) {
          return
        }

        subscription.active = false
        self.idle()
      },
      resume() {
        const subscriptions = state.subscriptions
        const subscription = subscriptionFind(value, subscriptions)

        if (subscription === undefined) {
          return
        }

        subscription.active = true

        if (state.state === TypeState.Idle) {
          self.resume()
        }
      },
      unsubscribe() {
        const subscriptions = state.subscriptions
        const subscription = subscriptionFind(value, subscriptions)

        if (subscription === undefined) {
          return
        }

        state.subscriptions = subscriptionRemove(value, subscriptions)
        self.idle()
      },
    }
  }

  public get fps() {
    return this.store.frameDeltaEMA !== 0 ? 1000 / this.store.frameDeltaEMA : 0
  }

  public set fps(value: number) {
    assertIsFPS(value)

    this.store.frameDeltaMin = 1000 / value
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
