import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockTimeController, isApproximatelyEqual, calculateTimingStats } from './test-utilities'

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
        const customController = new MockTimeController(1000)
        expect(customController.now()).toBe(1000)
      })

      it('advances time correctly', () => {
        expect(timeController.now()).toBe(0)

        timeController.advance(100)
        expect(timeController.now()).toBe(100)

        timeController.advance(50)
        expect(timeController.now()).toBe(150)
      })

      it('resets time and state correctly', () => {
        timeController.advance(500)
        expect(timeController.now()).toBe(500)

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

        timeController.advance(1)
        expect(callback).toHaveBeenCalledWith(1)
      })

      it('executes multiple callbacks in order', () => {
        const callback1 = vi.fn()
        const callback2 = vi.fn()
        const callback3 = vi.fn()

        globalThis.requestAnimationFrame(callback1)
        globalThis.requestAnimationFrame(callback2)
        globalThis.requestAnimationFrame(callback3)

        timeController.advance(1)

        expect(callback1).toHaveBeenCalledWith(1)
        expect(callback2).toHaveBeenCalledWith(1)
        expect(callback3).toHaveBeenCalledWith(1)
      })

      it('handles callback scheduling from within callbacks', () => {
        const callback1 = vi.fn()
        const callback2 = vi.fn()

        callback1.mockImplementation(() => {
          globalThis.requestAnimationFrame(callback2)
        })

        globalThis.requestAnimationFrame(callback1)
        timeController.advance(1)

        expect(callback1).toHaveBeenCalledWith(1)
        expect(callback2).not.toHaveBeenCalled()

        timeController.advance(0.001)
        expect(callback2).toHaveBeenCalledWith(1.001)
      })

      it('cancels callbacks correctly', () => {
        const callback = vi.fn()

        const id = globalThis.requestAnimationFrame(callback)
        globalThis.cancelAnimationFrame(id)

        timeController.advance(1)
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
        expect(() => timeController.advance(1)).not.toThrow()
        expect(errorCallback).toHaveBeenCalled()
        expect(normalCallback).toHaveBeenCalled()
      })
    })

    // describe('Performance API Mocking', () => {
    //   it('mocks performance.now() correctly', () => {
    //     expect(globalThis.performance.now()).toBe(0)
    //
    //     timeController.advance(100)
    //     expect(globalThis.performance.now()).toBe(100)
    //   })
    // })

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

        timeController.advance(1_000_000)
        expect(timeController.now()).toBe(1_000_000)
        expect(callback).toHaveBeenCalledWith(1_000_000)
      })

      it('handles rapid successive advances correctly', () => {
        const callback = vi.fn()

        for (let index = 0; index < 100; index++) {
          globalThis.requestAnimationFrame(callback)
          timeController.advance(1)
        }

        expect(callback).toHaveBeenCalledTimes(100)
        expect(timeController.now()).toBe(100)
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
      it('returns true for identical numbers', () => {
        expect(isApproximatelyEqual(5, 5)).toBe(true)
        expect(isApproximatelyEqual(0, 0)).toBe(true)
        expect(isApproximatelyEqual(-10, -10)).toBe(true)
      })

      it('returns true for numbers within default epsilon', () => {
        expect(isApproximatelyEqual(1, 1 + 1e-11)).toBe(true)
        expect(isApproximatelyEqual(1, 1 - 1e-11)).toBe(true)
      })

      it('returns false for numbers outside default epsilon', () => {
        expect(isApproximatelyEqual(1, 1.1)).toBe(false)
        expect(isApproximatelyEqual(1, 1.001)).toBe(false)
      })

      it('respects custom epsilon values', () => {
        expect(isApproximatelyEqual(1, 1.05, 0.1)).toBe(true)
        expect(isApproximatelyEqual(1, 1.05, 0.01)).toBe(false)
      })

      it('handles edge cases correctly', () => {
        expect(isApproximatelyEqual(0, 1e-11)).toBe(true)
        expect(isApproximatelyEqual(1e10, 1e10 + 1)).toBe(false)
        expect(isApproximatelyEqual(-1, -1.000_000_000_01)).toBe(true)
      })
    })

    describe('calculateTimingStats', () => {
      it('handles empty arrays correctly', () => {
        const stats = calculateTimingStats([])

        expect(stats.mean).toBe(0)
        expect(stats.median).toBe(0)
        expect(stats.min).toBe(0)
        expect(stats.max).toBe(0)
        expect(stats.standardDeviation).toBe(0)
        expect(stats.coefficientOfVariation).toBe(0)
      })

      it('calculates statistics correctly for single value', () => {
        const stats = calculateTimingStats([42])

        expect(stats.mean).toBe(42)
        expect(stats.median).toBe(42)
        expect(stats.min).toBe(42)
        expect(stats.max).toBe(42)
        expect(stats.standardDeviation).toBe(0)
        expect(stats.coefficientOfVariation).toBe(0)
      })

      it('calculates statistics correctly for multiple values', () => {
        const values = [10, 15, 20, 25, 30]
        const stats = calculateTimingStats(values)

        expect(stats.mean).toBe(20)
        expect(stats.median).toBe(20)
        expect(stats.min).toBe(10)
        expect(stats.max).toBe(30)
        expect(stats.standardDeviation).toBeCloseTo(7.07, 2)
        expect(stats.coefficientOfVariation).toBeCloseTo(0.35, 2)
      })

      it('calculates median correctly for even number of values', () => {
        const values = [1, 2, 3, 4]
        const stats = calculateTimingStats(values)

        expect(stats.median).toBe(2.5)
      })

      it('calculates median correctly for odd number of values', () => {
        const values = [1, 2, 3, 4, 5]
        const stats = calculateTimingStats(values)

        expect(stats.median).toBe(3)
      })

      it('handles coefficient of variation when mean is zero', () => {
        const values = [0, 0, 0]
        const stats = calculateTimingStats(values)

        expect(stats.coefficientOfVariation).toBe(0)
      })

      it('handles negative values correctly', () => {
        const values = [-10, -5, 0, 5, 10]
        const stats = calculateTimingStats(values)

        expect(stats.mean).toBe(0)
        expect(stats.median).toBe(0)
        expect(stats.min).toBe(-10)
        expect(stats.max).toBe(10)
      })
    })
  })
})
