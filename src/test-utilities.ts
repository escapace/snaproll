interface ScheduledCallback {
  callback: FrameRequestCallback
  id: number
  time: number
}

export class MockTimeController {
  private currentTime = 0
  private nextCallbackId = 1
  private scheduledCallbacks: ScheduledCallback[] = []

  constructor(initialTime = 0) {
    this.currentTime = initialTime
    this.setupGlobalMocks()
  }

  now(): number {
    return this.currentTime
  }

  advance(deltaMs: number): void {
    const targetTime = this.currentTime + deltaMs

    // First advance the time
    this.currentTime = targetTime

    // Process only one "frame" of callbacks to prevent infinite loops
    // This simulates how RAF actually works - only one callback execution per frame
    const eligibleCallbacks = this.scheduledCallbacks
      .filter((callback) => callback.time <= this.currentTime)
      .sort((a, b) => a.time - b.time)

    // Process all callbacks scheduled for this time, but only once per advance()
    const callbacksToProcess = [...eligibleCallbacks]

    // Remove all eligible callbacks before processing
    this.scheduledCallbacks = this.scheduledCallbacks.filter(
      (callback) => callback.time > this.currentTime,
    )

    callbacksToProcess.forEach((callback) => {
      try {
        callback.callback(this.currentTime)
      } catch (error) {
        // Log error but continue execution (this is expected behavior for error handling tests)
        if ((error as Error).message !== 'Test error') {
          console.error('Unexpected error in scheduled callback:', error)
        }
      }
    })
  }

  private setupGlobalMocks(): void {
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      const id = this.nextCallbackId++
      // Schedule for the next frame (minimum delay to allow proper frame processing)
      const scheduledTime = this.currentTime + 0.001

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

    globalThis.performance.now = (): number => this.currentTime

    // Store reference for internal use
    ;(
      globalThis as { _mockTimeController: MockTimeController } & typeof globalThis
    )._mockTimeController = this
  }

  reset(): void {
    this.currentTime = 0
    this.scheduledCallbacks = []
    this.nextCallbackId = 1
  }

  getScheduledCallbacks(): ScheduledCallback[] {
    return [...this.scheduledCallbacks]
  }
}

export function isApproximatelyEqual(a: number, b: number, epsilon = 1e-10): boolean {
  return Math.abs(a - b) <= epsilon
}

interface TimingStats {
  coefficientOfVariation: number
  max: number
  mean: number
  median: number
  min: number
  standardDeviation: number
}

export function calculateTimingStats(durations: number[]): TimingStats {
  if (durations.length === 0) {
    return {
      coefficientOfVariation: 0,
      max: 0,
      mean: 0,
      median: 0,
      min: 0,
      standardDeviation: 0,
    }
  }

  const sorted = [...durations].sort((a, b) => a - b)
  const sum = durations.reduce((accumulator, value) => accumulator + value, 0)
  const mean = sum / durations.length
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]

  const variance =
    durations.reduce((accumulator, value) => accumulator + Math.pow(value - mean, 2), 0) /
    durations.length
  const standardDeviation = Math.sqrt(variance)
  const coefficientOfVariation = mean !== 0 ? standardDeviation / mean : 0

  return {
    coefficientOfVariation,
    max: sorted[sorted.length - 1],
    mean,
    median,
    min: sorted[0],
    standardDeviation,
  }
}
