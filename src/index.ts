type CancelAnimationFrame = (handle: number) => void
type RequestAnimationFrame = (callback: (time: number) => void) => number

export enum TypeAction {
  FrameBegin,
  FrameUpdate,
  FrameDraw,
  FrameEnd,
}

interface ActionFrameBegin {
  frameDelta: number
  timestamp: number
  type: TypeAction.FrameBegin
}

interface ActionFrameUpdate {
  timestep: number
  type: TypeAction.FrameUpdate
}

interface ActionFrameDraw {
  delta: number
  panic: boolean
  type: TypeAction.FrameDraw
}

interface ActionFrameEnd {
  panic: boolean
  type: TypeAction.FrameEnd
}

export type Action = ActionFrameBegin | ActionFrameDraw | ActionFrameEnd | ActionFrameUpdate
export interface SubscriptionControls {
  pause: () => void
  resume: () => void
  unsubscribe: () => void
}
export type Subscription = (action: Action) => void

interface Options {
  cancelAnimationFrame: CancelAnimationFrame
  fps: number
  requestAnimationFrame: RequestAnimationFrame
  timestep: number
}

export interface SubscriptionState {
  active: boolean
  value: Subscription
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
  assert(isPositiveNumberOrUndefined(input), '[seedpods] fps must be a positive number')
}
function assertIsTimestep(input: unknown): asserts input is number | undefined {
  assert(isPositiveNumberOrUndefined(input), '[seedpods] timestep must be a positive number')
}

function assertOptions(
  options: Partial<Pick<Options, 'fps' | 'timestep'>>,
): asserts options is Partial<Pick<Options, 'fps' | 'timestep'>> {
  assertIsFPS(options.fps)
  assertIsTimestep(options.timestep)
}

const subscriptionRemove = (
  subscription: Subscription,
  subscriptions: SubscriptionState[],
): SubscriptionState[] => subscriptions.filter((element) => element.value !== subscription)

const subscriptionFind = (subscription: Subscription, subscriptions: SubscriptionState[]) =>
  subscriptions.find((element) => element.value === subscription)

const subscriptionActive = (subscriptions: SubscriptionState[]) =>
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

const createState = (
  options: { type?: TypeState } & Partial<Options>,
  subscriptions: SubscriptionState[] = [],
) => {
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
  const frameDeltaEMALastUpdate = 0

  // The number of frames delivered since the last time the `fps` moving
  // average was updated (i.e. since `lastFpsUpdate`).
  const frameDeltaEMAFramesSinceLastUpdate = 0

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

  const frameRequest: RequestAnimationFrame =
    options.requestAnimationFrame ?? requestAnimationFrame.bind(window)

  const frameCancel: CancelAnimationFrame =
    options.cancelAnimationFrame ?? cancelAnimationFrame.bind(window)

  return {
    frameCancel,
    frameDelta,
    frameDeltaEMA,
    frameDeltaEMAFramesSinceLastUpdate,
    frameDeltaEMALastUpdate,
    frameDeltaMin,
    frameId,
    frameRequest,
    panic,
    subscriptions,
    timestampLast,
    timestep,
    type,
    updateSteps,
    updateStepsMax,
  }
}

export const snaproll = (options: Partial<Options> = {}) => {
  let state = createState(options)

  const multiplexer = (action: Action) => {
    const reference = state.subscriptions
    const length = reference.length

    for (let index = 0; index < length; index++) {
      const subscription = reference[index]

      if (subscription.active) {
        subscription.value(action)
      }
    }
  }

  const resume = () => {
    if (state.type === TypeState.Active) {
      return
    }

    state.type = subscriptionActive(state.subscriptions) ? TypeState.Active : TypeState.Idle

    if (state.type === TypeState.Active) {
      state.frameId = state.frameRequest((timestamp) => {
        state.timestampLast = timestamp
        state.frameDeltaEMALastUpdate = timestamp
        state.frameDeltaEMAFramesSinceLastUpdate = 0

        state.frameId = state.frameRequest(animate)
      })
    }
  }

  const idle = () => {
    if (state.type !== TypeState.Active || subscriptionActive(state.subscriptions)) {
      return
    }

    state.frameCancel(state.frameId)
    state.type = TypeState.Idle
  }

  const pause = () => {
    if (state.type === TypeState.Paused) {
      return
    }

    if (state.type === TypeState.Active) {
      state.frameCancel(state.frameId)
    }

    state.type = TypeState.Paused
  }

  const animate = (timestamp: number) => {
    state.frameId = state.frameRequest(animate)
    const frameDelta = timestamp - state.timestampLast
    const frameDeltaDeviation = Math.max(0, state.frameDeltaMin - frameDelta) / state.frameDeltaEMA

    if (state.timestampLast + frameDeltaDeviation * state.frameDeltaMin > timestamp) {
      return
    }

    const frameDeltaEMAAlpha = 0.2
    // TODO: which is more performant

    // state.frameDeltaEMA =
    //   1 / (frameDeltaEMAAlpha / (frameDelta) + (1 - frameDeltaEMAAlpha) / state.frameDeltaEMA)

    const frameDeltaEMAUpdateInterval = 300
    if (timestamp > state.frameDeltaEMALastUpdate + frameDeltaEMAUpdateInterval) {
      state.frameDeltaEMA =
        1 /
        ((frameDeltaEMAAlpha * state.frameDeltaEMAFramesSinceLastUpdate) /
          (timestamp - state.frameDeltaEMALastUpdate) +
          (1 - frameDeltaEMAAlpha) / state.frameDeltaEMA)

      state.frameDeltaEMALastUpdate = timestamp
      state.frameDeltaEMAFramesSinceLastUpdate = 0
    }
    state.frameDeltaEMAFramesSinceLastUpdate++

    state.frameDelta += frameDelta
    state.timestampLast = timestamp

    multiplexer({
      frameDelta: state.frameDelta,
      timestamp,
      type: TypeAction.FrameBegin,
    })

    state.updateSteps = 0
    while (state.frameDelta >= state.timestep) {
      multiplexer({ timestep: state.timestep, type: TypeAction.FrameUpdate })
      state.frameDelta -= state.timestep

      // 4 seconds
      if (++state.updateSteps >= state.updateStepsMax) {
        state.panic = true
        break
      }
    }

    multiplexer({
      delta: state.frameDelta / state.timestep,
      panic: state.panic,
      type: TypeAction.FrameDraw,
    })

    // Run any updates that are not dependent on time in the simulation.
    multiplexer({
      panic: state.panic,
      type: TypeAction.FrameEnd,
    })

    state.panic = false
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
    reset(options: { keepSubscriptions?: boolean } & Partial<Options> = {}) {
      const keepSubscriptions = options?.keepSubscriptions !== false

      // preserve the options
      state = createState(
        {
          cancelAnimationFrame: options.cancelAnimationFrame ?? state.frameCancel,
          fps: options.fps ?? state.frameDeltaEMA,
          requestAnimationFrame: options.requestAnimationFrame ?? state.frameRequest,
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
    subscribe(value: Subscription, options?: { activate?: boolean }): SubscriptionControls {
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
