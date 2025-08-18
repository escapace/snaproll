import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockTimeController } from './mock-time-controller'

const TIME_VALUES = {
  CALLBACK_ADVANCE: 1,
  CUSTOM_INITIAL: 1000,
  FRAME_ADVANCE: 100,
  LARGE_ADVANCE: 1_000_000,
  RESET: 500,
  SMALL_ADVANCE: 50,
  SMALL_INCREMENT: 0.001,
} as const

const COUNT_VALUES = {
  MULTIPLE_CALLBACKS: 3,
  RAPID_ADVANCE: 100,
} as const

function createMockCallbacks(count: number): Array<ReturnType<typeof vi.fn>> {
  return Array.from({ length: count }, () => vi.fn())
}

function expectCallbacksCalledWith(
  callbacks: Array<ReturnType<typeof vi.fn>>,
  timestamp: number,
): void {
  callbacks.forEach((callback) => {
    expect(callback).toHaveBeenCalledWith(timestamp)
  })
}

function executeCallbackInTimeEnvironment(
  timeController: MockTimeController,
  callback: ReturnType<typeof vi.fn>,
  advanceTime: number = TIME_VALUES.CALLBACK_ADVANCE,
): void {
  globalThis.requestAnimationFrame(callback)
  timeController.advance(advanceTime)
}

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

      globalThis.requestAnimationFrame(callback1)
      timeController.advance(0.05)
      globalThis.requestAnimationFrame(callback2)
      timeController.advance(0.02)
      globalThis.requestAnimationFrame(callback3)

      timeController.advance(0.5)

      expect(executionOrder).toEqual([1, 2, 3])
    })
  })
})
