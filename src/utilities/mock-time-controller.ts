const MIN_FRAME_DELAY = 0.001
const DEFAULT_INITIAL_TIME = 0
const INITIAL_CALLBACK_ID = 1

interface ScheduledCallback {
  callback: FrameRequestCallback
  id: number
  time: number
}

export class MockTimeController {
  private currentTime = DEFAULT_INITIAL_TIME
  private nextCallbackId = INITIAL_CALLBACK_ID
  private scheduledCallbacks: ScheduledCallback[] = []

  constructor(initialTime = DEFAULT_INITIAL_TIME) {
    this.currentTime = initialTime
    this.setupGlobalMocks()
  }

  now(): number {
    return this.currentTime
  }

  advance(deltaMs: number): void {
    const targetTime = this.currentTime + deltaMs

    this.currentTime = targetTime

    const eligibleCallbacks = this.scheduledCallbacks
      .filter((callback) => callback.time <= this.currentTime)
      .sort((a, b) => a.time - b.time)

    const callbacksToProcess = [...eligibleCallbacks]

    this.scheduledCallbacks = this.scheduledCallbacks.filter(
      (callback) => callback.time > this.currentTime,
    )

    callbacksToProcess.forEach((scheduledCallback) => {
      try {
        scheduledCallback.callback(this.currentTime)
      } catch (error) {
        if ((error as Error).message !== 'Test error') {
          console.error('Unexpected error in scheduled callback:', error)
        }
      }
    })
  }

  private setupGlobalMocks(): void {
    globalThis.performance.now = this.now.bind(this)

    globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      const id = this.nextCallbackId++
      const scheduledTime = this.currentTime + MIN_FRAME_DELAY

      this.scheduledCallbacks.push({
        callback,
        id,
        time: scheduledTime,
      })

      return id
    }

    globalThis.cancelAnimationFrame = (id: number): void => {
      this.scheduledCallbacks = this.scheduledCallbacks.filter((callback) => callback.id !== id)
    }
    ;(
      globalThis as { _mockTimeController: MockTimeController } & typeof globalThis
    )._mockTimeController = this
  }

  reset(): void {
    this.currentTime = DEFAULT_INITIAL_TIME
    this.scheduledCallbacks = []
    this.nextCallbackId = INITIAL_CALLBACK_ID
  }

  getScheduledCallbacks(): ScheduledCallback[] {
    return [...this.scheduledCallbacks]
  }
}
