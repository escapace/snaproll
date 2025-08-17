import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MockTimeController,
  isApproximatelyEqual,
  calculateTimingStats,
  type TimingStats,
} from './test-utilities'

// ========================================
// Test Constants
// ========================================

/** Time values for MockTimeController testing */
const TIME_VALUES = {
  CALLBACK_ADVANCE: 1,
  CUSTOM_INITIAL: 1000,
  FRAME_ADVANCE: 100,
  LARGE_ADVANCE: 1_000_000,
  RESET: 500,
  SMALL_ADVANCE: 50,
  SMALL_INCREMENT: 0.001,
} as const

/** Count values for iteration testing */
const COUNT_VALUES = {
  MULTIPLE_CALLBACKS: 3,
  RAPID_ADVANCE: 100,
} as const

// ========================================
// Test Data
// ========================================

/** Test cases for isApproximatelyEqual function */
const APPROXIMATE_EQUALITY_TEST_DATA = {
  /** Identical number pairs that should always be equal */
  IDENTICAL_PAIRS: [
    [5, 5],
    [0, 0],
    [-10, -10],
  ] as const,

  /** Default epsilon boundary test cases */
  EPSILON_CASES: [
    { a: 1, b: 1 + 1e-11, description: 'within default epsilon', expected: true },
    { a: 1, b: 1 - 1e-11, description: 'within default epsilon (negative)', expected: true },
    { a: 1, b: 1.1, description: 'outside default epsilon', expected: false },
    { a: 1, b: 1.001, description: 'outside default epsilon (smaller diff)', expected: false },
  ] as const,

  /** Custom epsilon test cases */
  CUSTOM_EPSILON_CASES: [
    { a: 1, b: 1.05, epsilon: 0.1, expected: true },
    { a: 1, b: 1.05, epsilon: 0.01, expected: false },
  ] as const,

  /** Edge cases for floating-point comparison */
  EDGE_CASES: [
    { a: 0, b: 1e-11, description: 'zero vs tiny number', expected: true },
    { a: 1e10, b: 1e10 + 1, description: 'large numbers with unit difference', expected: false },
    { a: -1, b: -1.000_000_000_01, description: 'negative numbers within epsilon', expected: true },
  ] as const,
} as const

/** Test cases for calculateTimingStats function */
const TIMING_STATS_TEST_DATA = [
  {
    expected: {
      coefficientOfVariation: 0,
      max: 42,
      mean: 42,
      median: 42,
      min: 42,
      standardDeviation: 0,
    },
    name: 'single value',
    values: [42],
  },
  {
    expected: {
      coefficientOfVariation: 0.35,
      max: 30,
      mean: 20,
      median: 20,
      min: 10,
      standardDeviation: 7.07,
    },
    name: 'multiple values',
    values: [10, 15, 20, 25, 30],
  },
  {
    expected: {
      coefficientOfVariation: 0.45,
      max: 4,
      mean: 2.5,
      median: 2.5,
      min: 1,
      standardDeviation: 1.12,
    },
    name: 'even number of values (median)',
    values: [1, 2, 3, 4],
  },
  {
    expected: {
      coefficientOfVariation: 0.47,
      max: 5,
      mean: 3,
      median: 3,
      min: 1,
      standardDeviation: 1.41,
    },
    name: 'odd number of values (median)',
    values: [1, 2, 3, 4, 5],
  },
  {
    expected: {
      coefficientOfVariation: 0,
      max: 0,
      mean: 0,
      median: 0,
      min: 0,
      standardDeviation: 0,
    },
    name: 'zero values (coefficient edge case)',
    values: [0, 0, 0],
  },
  {
    expected: {
      coefficientOfVariation: 0,
      max: 10,
      mean: 0,
      median: 0,
      min: -10,
      standardDeviation: 7.07,
    },
    name: 'negative values',
    values: [-10, -5, 0, 5, 10],
  },
] as const

// ========================================
// Helper Functions
// ========================================

/**
 * Creates multiple mock callbacks for testing.
 * @param count - Number of callbacks to create
 * @returns Array of vitest mock functions
 */
function createMockCallbacks(count: number): Array<ReturnType<typeof vi.fn>> {
  return Array.from({ length: count }, () => vi.fn())
}

/**
 * Verifies that all callbacks were called with the expected timestamp.
 * @param callbacks - Array of mock callback functions to verify
 * @param timestamp - Expected timestamp value
 */
function expectCallbacksCalledWith(
  callbacks: Array<ReturnType<typeof vi.fn>>,
  timestamp: number,
): void {
  callbacks.forEach((callback) => {
    expect(callback).toHaveBeenCalledWith(timestamp)
  })
}

/**
 * Verifies that a TimingStats object contains all zero values.
 * Used to test empty array handling in calculateTimingStats.
 * @param stats - TimingStats object to verify
 */
function expectEmptyStats(stats: TimingStats): void {
  expect(stats.mean).toBe(0)
  expect(stats.median).toBe(0)
  expect(stats.min).toBe(0)
  expect(stats.max).toBe(0)
  expect(stats.standardDeviation).toBe(0)
  expect(stats.coefficientOfVariation).toBe(0)
}

/**
 * Executes a callback in a controlled time environment.
 * @param timeController - Mock time controller instance
 * @param callback - Callback function to execute
 * @param advanceTime - Time to advance after scheduling
 * @returns The callback result
 */
function executeCallbackInTimeEnvironment(
  timeController: MockTimeController,
  callback: ReturnType<typeof vi.fn>,
  advanceTime: number = TIME_VALUES.CALLBACK_ADVANCE,
): void {
  globalThis.requestAnimationFrame(callback)
  timeController.advance(advanceTime)
}

/**
 * Creates a test scenario with multiple callbacks and executes them.
 * @param timeController - Mock time controller instance
 * @param callbackCount - Number of callbacks to create and execute
 * @param advanceTime - Time to advance for execution
 * @returns Array of executed callbacks
 */
function createAndExecuteMultipleCallbacks(
  timeController: MockTimeController,
  callbackCount: number = COUNT_VALUES.MULTIPLE_CALLBACKS,
  advanceTime: number = TIME_VALUES.CALLBACK_ADVANCE,
): Array<ReturnType<typeof vi.fn>> {
  const callbacks = createMockCallbacks(callbackCount)
  callbacks.forEach((callback) => globalThis.requestAnimationFrame(callback))
  timeController.advance(advanceTime)
  return callbacks
}

// ========================================
// Test Suites
// ========================================

describe('Test Utilities', () => {
  describe('MockTimeController', () => {
    let timeController: MockTimeController

    beforeEach(() => {
      timeController = new MockTimeController()
    })

    describe('Time Management', () => {
      it('initializes with zero time by default', () => {
        expect(timeController.now()).toBe(0)
      })

      it('initializes with custom time when provided', () => {
        const customController = new MockTimeController(TIME_VALUES.CUSTOM_INITIAL)
        expect(customController.now()).toBe(TIME_VALUES.CUSTOM_INITIAL)
      })

      it('advances time correctly', () => {
        expect(timeController.now()).toBe(0)

        timeController.advance(TIME_VALUES.FRAME_ADVANCE)
        expect(timeController.now()).toBe(TIME_VALUES.FRAME_ADVANCE)

        timeController.advance(TIME_VALUES.SMALL_ADVANCE)
        expect(timeController.now()).toBe(TIME_VALUES.FRAME_ADVANCE + TIME_VALUES.SMALL_ADVANCE)
      })

      it('resets time and state correctly', () => {
        timeController.advance(TIME_VALUES.RESET)
        expect(timeController.now()).toBe(TIME_VALUES.RESET)

        timeController.reset()
        expect(timeController.now()).toBe(0)
        expect(timeController.getScheduledCallbacks()).toHaveLength(0)
      })
    })

    describe('requestAnimationFrame Mocking', () => {
      it('schedules callbacks correctly', () => {
        const callback = vi.fn()

        const id = globalThis.requestAnimationFrame(callback)
        expect(id).toBeGreaterThan(0)
        expect(callback).not.toHaveBeenCalled()

        const scheduled = timeController.getScheduledCallbacks()
        expect(scheduled).toHaveLength(1)
        expect(scheduled[0].id).toBe(id)
      })

      it('executes callbacks when time advances', () => {
        const callback = vi.fn()

        globalThis.requestAnimationFrame(callback)
        expect(callback).not.toHaveBeenCalled()

        timeController.advance(TIME_VALUES.CALLBACK_ADVANCE)
        expect(callback).toHaveBeenCalledWith(TIME_VALUES.CALLBACK_ADVANCE)
      })

      it('executes multiple callbacks in order', () => {
        const callbacks = createAndExecuteMultipleCallbacks(
          timeController,
          COUNT_VALUES.MULTIPLE_CALLBACKS,
          TIME_VALUES.CALLBACK_ADVANCE,
        )

        expectCallbacksCalledWith(callbacks, TIME_VALUES.CALLBACK_ADVANCE)
      })

      it('handles callback scheduling from within callbacks', () => {
        const callback1 = vi.fn()
        const callback2 = vi.fn()

        callback1.mockImplementation(() => {
          globalThis.requestAnimationFrame(callback2)
        })

        executeCallbackInTimeEnvironment(timeController, callback1, TIME_VALUES.CALLBACK_ADVANCE)

        expect(callback1).toHaveBeenCalledWith(TIME_VALUES.CALLBACK_ADVANCE)
        expect(callback2).not.toHaveBeenCalled()

        timeController.advance(TIME_VALUES.SMALL_INCREMENT)
        expect(callback2).toHaveBeenCalledWith(
          TIME_VALUES.CALLBACK_ADVANCE + TIME_VALUES.SMALL_INCREMENT,
        )
      })

      it('cancels callbacks correctly', () => {
        const callback = vi.fn()

        const id = globalThis.requestAnimationFrame(callback)
        globalThis.cancelAnimationFrame(id)

        timeController.advance(TIME_VALUES.CALLBACK_ADVANCE)
        expect(callback).not.toHaveBeenCalled()
        expect(timeController.getScheduledCallbacks()).toHaveLength(0)
      })

      it('handles callback errors gracefully', () => {
        const errorCallback = vi.fn(() => {
          throw new Error('Test error')
        })
        const normalCallback = vi.fn()

        globalThis.requestAnimationFrame(errorCallback)
        globalThis.requestAnimationFrame(normalCallback)

        // Should not throw and should continue with other callbacks
        expect(() => timeController.advance(TIME_VALUES.CALLBACK_ADVANCE)).not.toThrow()
        expect(errorCallback).toHaveBeenCalled()
        expect(normalCallback).toHaveBeenCalled()
      })
    })

    describe('Edge Cases', () => {
      it('handles zero time advance correctly', () => {
        const callback = vi.fn()
        globalThis.requestAnimationFrame(callback)

        timeController.advance(0)
        expect(timeController.now()).toBe(0)
      })

      it('handles large time advances correctly', () => {
        const callback = vi.fn()
        globalThis.requestAnimationFrame(callback)

        timeController.advance(TIME_VALUES.LARGE_ADVANCE)
        expect(timeController.now()).toBe(TIME_VALUES.LARGE_ADVANCE)
        expect(callback).toHaveBeenCalledWith(TIME_VALUES.LARGE_ADVANCE)
      })

      it('handles rapid successive advances correctly', () => {
        const callback = vi.fn()

        for (let index = 0; index < COUNT_VALUES.RAPID_ADVANCE; index++) {
          globalThis.requestAnimationFrame(callback)
          timeController.advance(TIME_VALUES.CALLBACK_ADVANCE)
        }

        expect(callback).toHaveBeenCalledTimes(COUNT_VALUES.RAPID_ADVANCE)
        expect(timeController.now()).toBe(COUNT_VALUES.RAPID_ADVANCE)
      })

      it('maintains callback execution order with different scheduled times', () => {
        const executionOrder: number[] = []

        const callback1 = vi.fn(() => executionOrder.push(1))
        const callback2 = vi.fn(() => executionOrder.push(2))
        const callback3 = vi.fn(() => executionOrder.push(3))

        globalThis.requestAnimationFrame(callback1) // Scheduled for time 0.1
        timeController.advance(0.05)
        globalThis.requestAnimationFrame(callback2) // Scheduled for time 0.15
        timeController.advance(0.02)
        globalThis.requestAnimationFrame(callback3) // Scheduled for time 0.17

        timeController.advance(0.5) // Execute all

        expect(executionOrder).toEqual([1, 2, 3])
      })
    })
  })

  describe('Utility Functions', () => {
    describe('isApproximatelyEqual', () => {
      it.each(APPROXIMATE_EQUALITY_TEST_DATA.IDENTICAL_PAIRS)(
        'returns true for identical numbers: %d and %d',
        (a, b) => {
          expect(isApproximatelyEqual(a, b)).toBe(true)
        },
      )

      it.each(APPROXIMATE_EQUALITY_TEST_DATA.EPSILON_CASES)(
        '$description',
        ({ a, b, expected }) => {
          expect(isApproximatelyEqual(a, b)).toBe(expected)
        },
      )

      it.each(APPROXIMATE_EQUALITY_TEST_DATA.CUSTOM_EPSILON_CASES)(
        'respects custom epsilon: $a vs $b with epsilon $epsilon',
        ({ a, b, epsilon, expected }) => {
          expect(isApproximatelyEqual(a, b, epsilon)).toBe(expected)
        },
      )

      it.each(APPROXIMATE_EQUALITY_TEST_DATA.EDGE_CASES)(
        'handles edge case: $description',
        ({ a, b, expected }) => {
          expect(isApproximatelyEqual(a, b)).toBe(expected)
        },
      )
    })

    describe('calculateTimingStats', () => {
      it('handles empty arrays correctly', () => {
        const stats = calculateTimingStats([])
        expectEmptyStats(stats)
      })

      it.each(TIMING_STATS_TEST_DATA)(
        'calculates statistics correctly for $name',
        ({ expected, values }) => {
          const stats = calculateTimingStats(values)

          expect(stats.mean).toBe(expected.mean)
          expect(stats.median).toBe(expected.median)
          expect(stats.min).toBe(expected.min)
          expect(stats.max).toBe(expected.max)

          if (expected.standardDeviation === 0) {
            expect(stats.standardDeviation).toBe(0)
          } else {
            expect(stats.standardDeviation).toBeCloseTo(expected.standardDeviation, 2)
          }

          if (expected.coefficientOfVariation === 0) {
            expect(stats.coefficientOfVariation).toBe(0)
          } else {
            expect(stats.coefficientOfVariation).toBeCloseTo(expected.coefficientOfVariation, 2)
          }
        },
      )
    })
  })
})
