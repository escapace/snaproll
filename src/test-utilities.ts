// ========================================
// Constants
// ========================================

/** Minimum delay to ensure proper frame processing in MockTimeController */
const MIN_FRAME_DELAY = 0.001

/** Default initial time value */
const DEFAULT_INITIAL_TIME = 0

/** Initial callback ID counter value */
const INITIAL_CALLBACK_ID = 1

/** Default epsilon for floating-point comparison */
const DEFAULT_EPSILON = 1e-10

/** Default value for empty statistics calculations */
const EMPTY_STATS_VALUE = 0

// ========================================
// Types and Interfaces
// ========================================

/**
 * Internal structure for tracking scheduled requestAnimationFrame callbacks.
 * Maintains execution order based on scheduled time to ensure deterministic frame processing.
 */
interface ScheduledCallback {
  /** Function to execute when frame time is reached */
  callback: FrameRequestCallback
  /** Unique identifier returned by requestAnimationFrame */
  id: number
  /** Scheduled execution time in milliseconds */
  time: number
}

/**
 * Statistical metrics for analyzing timing performance data.
 * Provides both central tendency measures and variability indicators
 * to assess timing consistency and identify performance outliers.
 * All values are zero for empty input arrays.
 */
export interface TimingStats {
  /** Ratio of standard deviation to mean; zero when mean is zero to avoid division by zero */
  coefficientOfVariation: number
  /** Largest value in the dataset */
  max: number
  /** Arithmetic average of all values */
  mean: number
  /** Middle value when sorted; average of two middle values for even-length arrays */
  median: number
  /** Smallest value in the dataset */
  min: number
  /** Square root of population variance, measuring absolute variability from mean */
  standardDeviation: number
}

// ========================================
// Mock Time Controller
// ========================================

/**
 * Provides deterministic time control for testing animation loops.
 * Replaces global requestAnimationFrame and cancelAnimationFrame with controllable implementations.
 * Time advances only when advance() is explicitly called, ensuring predictable test execution.
 * Prevents infinite loops by processing only one frame of callbacks per advance() call,
 * matching real browser behavior where callbacks execute once per frame.
 */
export class MockTimeController {
  private currentTime = DEFAULT_INITIAL_TIME
  private nextCallbackId = INITIAL_CALLBACK_ID
  private scheduledCallbacks: ScheduledCallback[] = []

  /**
   * Creates mock time controller and immediately installs global mocks.
   * Replaces globalThis.requestAnimationFrame and globalThis.cancelAnimationFrame
   * with controlled implementations that respond to advance() calls.
   * @param initialTime - Starting time value in milliseconds; defaults to 0
   */
  constructor(initialTime = DEFAULT_INITIAL_TIME) {
    this.currentTime = initialTime
    this.setupGlobalMocks()
  }

  /**
   * Returns current mock time.
   * Time only advances when advance() is called, providing deterministic testing.
   * Initial value is set during construction.
   * @returns Current time in milliseconds
   */
  now(): number {
    return this.currentTime
  }

  /**
   * Advances mock time and executes eligible callbacks.
   * Updates current time first, then processes all callbacks scheduled at or before the new time.
   * Processes only one frame of callbacks to prevent infinite loops when callbacks schedule new callbacks.
   * Callbacks are executed in chronological order by scheduled time.
   * Continues execution even if callbacks throw errors, enabling error handling tests.
   * Newly scheduled callbacks during execution will not run until the next advance() call.
   * @param deltaMs - Time to advance in milliseconds; must be non-negative
   */
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

    callbacksToProcess.forEach((scheduledCallback) => {
      try {
        scheduledCallback.callback(this.currentTime)
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

    // Store reference for internal use
    ;(
      globalThis as { _mockTimeController: MockTimeController } & typeof globalThis
    )._mockTimeController = this
  }

  /**
   * Resets time and clears all scheduled callbacks.
   * Restores initial time value and callback ID counter to starting state.
   * Mock functions remain installed on global objects.
   * Pending callbacks are discarded without execution.
   */
  reset(): void {
    this.currentTime = DEFAULT_INITIAL_TIME
    this.scheduledCallbacks = []
    this.nextCallbackId = INITIAL_CALLBACK_ID
  }

  /**
   * Returns copy of currently scheduled callbacks for debugging.
   * Useful for inspecting scheduled callback state during test development.
   * @returns Array of pending callbacks with their scheduled times and IDs
   */
  getScheduledCallbacks(): ScheduledCallback[] {
    return [...this.scheduledCallbacks]
  }
}

// ========================================
// Utility Functions
// ========================================

/**
 * Compares floating-point numbers with epsilon tolerance.
 * Necessary because floating-point arithmetic can introduce small rounding errors
 * that make exact equality unreliable for computed values.
 * Uses absolute difference comparison: |a - b| <= epsilon.
 * @param a - First number to compare
 * @param b - Second number to compare
 * @param epsilon - Maximum allowed absolute difference; defaults to 1e-10 for high precision
 * @returns True if absolute difference between numbers is within epsilon tolerance
 */
export function isApproximatelyEqual(a: number, b: number, epsilon = DEFAULT_EPSILON): boolean {
  return Math.abs(a - b) <= epsilon
}

/**
 * Calculates statistical metrics for timing performance analysis.
 * Returns zero values for empty arrays to avoid undefined behavior.
 * Uses population variance calculation (dividing by n) rather than sample variance (n-1)
 * since timing measurements represent complete populations, not samples.
 * Sorts input array internally without modifying the original.
 * @param durations - Array of timing values in any unit; must contain finite numbers
 * @returns Statistical metrics including central tendency and variability measures
 */
export function calculateTimingStats(durations: readonly number[]): TimingStats {
  if (durations.length === 0) {
    return {
      coefficientOfVariation: EMPTY_STATS_VALUE,
      max: EMPTY_STATS_VALUE,
      mean: EMPTY_STATS_VALUE,
      median: EMPTY_STATS_VALUE,
      min: EMPTY_STATS_VALUE,
      standardDeviation: EMPTY_STATS_VALUE,
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
