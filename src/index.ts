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
  panic: boolean
  type: SnaprollActionType.Draw
}

export type SnaprollAction = SnaprollActionBegin | SnaprollActionDraw | SnaprollActionUpdate

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

type SnaprollActionMultiplexer = Partial<
  { type: SnaprollActionType } & Omit<SnaprollActionBegin, 'type'> &
    Omit<SnaprollActionDraw, 'type'> &
    Omit<SnaprollActionUpdate, 'type'>
>

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

const calculateUpdateStepsMax = (timestep: number) => Math.round(4000 / timestep)

interface State {
  frameDelta: number
  frameDeltaEMA: number
  frameDeltaMin: number
  frameId: number
  panic: boolean
  pool: SnaprollActionMultiplexer
  subscriptions: SnaprollSubscriptionState[]
  timestampLast: number
  timestep: number
  type: TypeState
  updateSteps: number
  updateStepsMax: number
}

const createState = (
  options: { type?: TypeState } & Partial<SnaprollOptions>,
  subscriptions: SnaprollSubscriptionState[] = [],
): State => {
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

  // The number of times update() is called in a given frame. This is only
  // relevant inside of animate(), but a reference is held externally so that
  // this variable is not marked for garbage collection every time the main
  // loop runs.
  const updateSteps = 0
  const updateStepsMax = calculateUpdateStepsMax(timestep)

  // The minimum amount of time in milliseconds that must pass since the last
  // frame was executed before another frame can be executed.
  const frameDeltaMin = 1000 / (options.fps ?? 60)

  const type = options.type ?? TypeState.Paused

  // Whether the simulation has fallen too far behind real time.
  // Specifically, `panic` will be set to `true` if too many updates occur in
  // one frame. This is only relevant inside of animate(), but a reference is
  // held externally so that this variable is not marked for garbage
  // collection every time the main loop runs.
  const panic = false

  // The ID of the currently executing frame. Used to cancel frames when
  // stopping the loop.
  const frameId = 0

  const pool: SnaprollActionMultiplexer = {
    delta: undefined,
    panic: undefined,
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
    panic,
    pool,
    subscriptions,
    timestampLast,
    timestep,
    type,
    updateSteps,
    updateStepsMax,
  }
}

export const snaproll = (options: Partial<SnaprollOptions> = {}) => {
  let state = createState(options)
  const pool = state.pool

  const multiplexer = (action: SnaprollActionMultiplexer) => {
    const reference = state.subscriptions
    const length = reference.length

    for (let index = 0; index < length; index++) {
      const subscription = reference[index]

      if (subscription.active) {
        subscription.value(action as SnaprollAction)
      }
    }
  }

  const resume = () => {
    if (state.type === TypeState.Active) {
      return
    }

    state.type = subscriptionActive(state.subscriptions) ? TypeState.Active : TypeState.Idle

    if (state.type === TypeState.Active) {
      state.frameId = requestAnimationFrame((timestamp) => {
        state.timestampLast = timestamp
        // state.frameDeltaEMALastUpdate = timestamp
        // state.frameDeltaEMAFramesSinceLastUpdate = 0

        state.frameId = requestAnimationFrame(animate)
      })
    }
  }

  const idle = () => {
    if (state.type !== TypeState.Active || subscriptionActive(state.subscriptions)) {
      return
    }

    cancelAnimationFrame(state.frameId)
    state.type = TypeState.Idle
  }

  const pause = () => {
    if (state.type === TypeState.Paused) {
      return
    }

    if (state.type === TypeState.Active) {
      cancelAnimationFrame(state.frameId)
    }

    state.type = TypeState.Paused
  }

  const animate = (timestamp: number) => {
    state.frameId = requestAnimationFrame(animate)
    const frameDelta = timestamp - state.timestampLast
    const frameDeltaDeviation = Math.max(0, state.frameDeltaMin - frameDelta) / state.frameDeltaEMA

    if (state.timestampLast + frameDeltaDeviation * state.frameDeltaMin > timestamp) {
      return
    }

    // TODO: esroll variable for build
    if (__ENVIRONMENT__ !== 'production') {
      performance.mark('animate-start')
    }

    state.frameDeltaEMA =
      1 / (FRAME_DELTA_EMA_ALPHA / frameDelta + FRAME_DELTA_EMA_ALPHA_REVERSE / state.frameDeltaEMA)

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

    state.frameDelta += frameDelta
    state.timestampLast = timestamp

    pool.type = SnaprollActionType.Begin
    pool.timestamp = timestamp

    multiplexer(pool)

    state.updateSteps = 0
    while (state.frameDelta >= state.timestep) {
      pool.type = SnaprollActionType.Update
      pool.timestep = state.timestep
      multiplexer(pool)

      state.frameDelta -= state.timestep

      // 4 seconds
      if (++state.updateSteps >= state.updateStepsMax) {
        state.panic = true
        break
      }
    }

    pool.type = SnaprollActionType.Draw
    pool.timestep = state.timestep
    pool.delta = state.frameDelta
    pool.panic = state.panic
    multiplexer(pool)

    state.panic = false

    if (__ENVIRONMENT__ !== 'production') {
      performance.measure('animate', { end: performance.now(), start: 'animate-start' })
    }
  }

  return {
    get fps() {
      // return 1000 / state.frameDeltaEMA
      return state.frameDeltaEMA !== 0 ? 1000 / state.frameDeltaEMA : 0
    },
    set fps(value: number) {
      assertIsFPS(value)

      state.frameDeltaMin = 1000 / value
    },
    pause,
    reset(options: { keepSubscriptions?: boolean } & Partial<SnaprollOptions> = {}) {
      const keepSubscriptions = options?.keepSubscriptions !== false

      // preserve the options
      state = createState(
        {
          fps: options.fps ?? state.frameDeltaEMA,
          timestep: options.timestep ?? state.timestep,
          type: state.type,
        },
        keepSubscriptions ? [...state.subscriptions] : undefined,
      )
    },
    resetFrameDelta() {
      const oldFrameDelta = state.frameDelta
      state.frameDelta = 0

      // The cumulative amount of elapsed time in milliseconds that has not yet
      // been simulated, but is being discarded as a result of calling this
      // function.
      return oldFrameDelta
    },
    resume,
    get state() {
      return STATES[state.type]
    },
    subscribe(
      value: SnaprollSubscription,
      options?: { activate?: boolean },
    ): SnaprollSubscriptionControls {
      if (subscriptionFind(value, state.subscriptions) === undefined) {
        const reference = state.subscriptions
        const active = options?.activate !== false
        state.subscriptions = [...reference, { active, value }]

        if (state.type === TypeState.Idle) {
          resume()
        }
      }

      return {
        pause: () => {
          const subscriptions = state.subscriptions
          const subscription = subscriptionFind(value, subscriptions)

          if (subscription === undefined) {
            return
          }

          subscription.active = false
          idle()
        },
        resume: () => {
          const subscriptions = state.subscriptions
          const subscription = subscriptionFind(value, subscriptions)

          if (subscription === undefined) {
            return
          }

          subscription.active = true

          if (state.type === TypeState.Idle) {
            resume()
          }
        },
        unsubscribe() {
          const subscriptions = state.subscriptions
          const subscription = subscriptionFind(value, subscriptions)

          if (subscription === undefined) {
            return
          }

          state.subscriptions = subscriptionRemove(value, subscriptions)
          idle()
        },
      }
    },
    // How many milliseconds should be simulated by every update.
    get timestep() {
      return state.timestep
    },
    // How many milliseconds should be simulated by every update.
    set timestep(value: number) {
      assertIsTimestep(value)

      state.timestep = value
      state.updateStepsMax = calculateUpdateStepsMax(state.timestep)
    },
  }
}
