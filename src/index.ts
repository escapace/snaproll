type CancelAnimationFrame = (handle: number) => void
type RequestAnimationFrame = (callback: (time: number) => void) => number

export enum TypeAction {
  BEGIN = 0,
  UPDATE = 1,
  DRAW = 2,
  END = 3
}

interface ActionBegin {
  type: TypeAction.BEGIN
  timestamp: number
  frameDelta: number
}

interface ActionUpdate {
  type: TypeAction.UPDATE
  timestep: number
}

interface ActionDraw {
  type: TypeAction.DRAW
  delta: number
  panic: boolean
}

interface ActionEnd {
  type: TypeAction.END
  panic: boolean
}

export type Action = ActionBegin | ActionUpdate | ActionDraw | ActionEnd
export type Subscription = (action: Action) => void

interface Options {
  requestAnimationFrame: RequestAnimationFrame
  cancelAnimationFrame: CancelAnimationFrame
  fps: number
  timestep: number
}

// Four seconds
const calculateMaxUpdateSteps = (timestep: number) =>
  Math.round(4000 / timestep)

const createState = (options: Partial<Pick<Options, 'timestep' | 'fps'>>) => {
  // An exponential moving average of the frames per second.
  const fps = 0

  // The amount of time (in milliseconds) to simulate each time update()
  // runs
  const timestep = options.timestep ?? 1000 / 60

  // The cumulative amount of in-app time that hasn't been simulated yet.
  const frameDelta = 0

  // The timestamp in milliseconds of the last time the main loop was run.
  const lastFrameTime = 0

  // A factor that affects how heavily to weight more recent seconds'
  // performance when calculating the average frames per second. Valid values
  // range from zero to one inclusive. Higher values result in weighting more
  // recent seconds more heavily.
  const fpsAlpha = 0.9

  // The minimum duration between updates to the frames-per-second estimate.
  // Higher values increase accuracy, but result in slower updates.
  const fpsUpdateInterval = 1000

  // The timestamp (in milliseconds) of the last time the `fps` moving
  // average was updated.
  const lastFpsUpdate = 0

  // The number of frames delivered since the last time the `fps` moving
  // average was updated (i.e. since `lastFpsUpdate`).
  const framesSinceLastFpsUpdate = 0

  // The number of times update() is called in a given frame. This is only
  // relevant inside of animate(), but a reference is held externally so that
  // this variable is not marked for garbage collection every time the main
  // loop runs.
  const numUpdateSteps = 0
  const maxUpdateSteps = calculateMaxUpdateSteps(timestep)

  // The minimum amount of time in milliseconds that must pass since the last
  // frame was executed before another frame can be executed.
  const minDrawDelay = 1000 / (options.fps ?? Infinity)

  const lastDrawTime = 0

  const isActive = false

  // Whether the simulation has fallen too far behind real time.
  // Specifically, `panic` will be set to `true` if too many updates occur in
  // one frame. This is only relevant inside of animate(), but a reference is
  // held externally so that this variable is not marked for garbage
  // collection every time the main loop runs.
  const panic = false

  // The ID of the currently executing frame. Used to cancel frames when
  // stopping the loop.
  const rafHandle = 0

  return {
    fps,
    fpsAlpha,
    fpsUpdateInterval,
    frameDelta,
    framesSinceLastFpsUpdate,
    isActive,
    lastFpsUpdate,
    lastFrameTime,
    maxUpdateSteps,
    lastDrawTime,
    minDrawDelay,
    numUpdateSteps,
    panic,
    rafHandle,
    timestep
  }
}

export const snaproll = (
  subscription: Subscription,
  options: Partial<Options> = {}
) => {
  let state = createState(options)

  const _requestAnimationFrame: RequestAnimationFrame =
    options.requestAnimationFrame ?? requestAnimationFrame

  const _cancelAnimationFrame: CancelAnimationFrame =
    options.cancelAnimationFrame ?? cancelAnimationFrame

  const resume = () => {
    if (!state.isActive) {
      state.isActive = true
      state.rafHandle = _requestAnimationFrame((timestamp) => {
        state.lastFrameTime = timestamp
        state.lastFpsUpdate = timestamp
        state.framesSinceLastFpsUpdate = 0

        animate(timestamp)
      })
    }
  }

  const pause = () => {
    state.isActive = false
    _cancelAnimationFrame(state.rafHandle)
  }

  const animate = (timestamp: number) => {
    state.rafHandle = _requestAnimationFrame(animate)

    // if (state.lastFrameTime > timestamp) {
    //   return
    // }

    state.frameDelta += timestamp - state.lastFrameTime
    state.lastFrameTime = timestamp

    subscription({
      type: TypeAction.BEGIN,
      timestamp,
      frameDelta: state.frameDelta
    })

    state.numUpdateSteps = 0

    while (state.frameDelta >= state.timestep) {
      subscription({ type: TypeAction.UPDATE, timestep: state.timestep })
      state.frameDelta -= state.timestep

      // 4 seconds
      if (++state.numUpdateSteps >= state.maxUpdateSteps) {
        state.panic = true
        break
      }
    }

    const drawDelta = timestamp - state.lastDrawTime

    if (drawDelta >= state.minDrawDelay) {
      state.lastDrawTime =
        timestamp -
        (state.minDrawDelay === 0 ? 0 : drawDelta % state.minDrawDelay)

      if (timestamp > state.lastFpsUpdate + state.fpsUpdateInterval) {
        state.fps =
          (state.fpsAlpha * state.framesSinceLastFpsUpdate * 1000) /
            (timestamp - state.lastFpsUpdate) +
          (1 - state.fpsAlpha) * state.fps

        state.lastFpsUpdate = timestamp
        state.framesSinceLastFpsUpdate = 0
      }

      state.framesSinceLastFpsUpdate++

      subscription({
        type: TypeAction.DRAW,
        delta: state.frameDelta / state.timestep,
        panic: state.panic
      })
    }

    // Run any updates that are not dependent on time in the simulation.
    subscription({
      type: TypeAction.END,
      panic: state.panic
    })

    state.panic = false
  }

  return {
    get isActive() {
      return state.isActive
    },
    // How many milliseconds should be simulated by every update.
    get timestep() {
      return state.timestep
    },
    // How many milliseconds should be simulated by every update.
    set timestep(value: number) {
      state.timestep = value
      state.maxUpdateSteps = calculateMaxUpdateSteps(value)
    },
    get fps() {
      return state.fps
    },
    set fps(value: number) {
      if (value <= 0) {
        pause()
      } else {
        // Dividing by Infinity returns zero.
        state.minDrawDelay = 1000 / value
      }
    },
    resetFrameDelta() {
      const oldFrameDelta = state.frameDelta
      state.frameDelta = 0

      // The cumulative amount of elapsed time in milliseconds that has not yet
      // been simulated, but is being discarded as a result of calling this
      // function.
      return oldFrameDelta
    },
    reset(options: Partial<Pick<Options, 'timestep' | 'fps'>>) {
      pause()

      // preserve the options
      state = createState({
        fps: options.fps ?? 1000 / state.minDrawDelay,
        timestep: options.timestep ?? state.timestep
      })
    },
    pause,
    resume
  }
}
