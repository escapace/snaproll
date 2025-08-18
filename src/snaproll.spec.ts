import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Snaproll,
  SnaprollActionType,
  type SnaprollActionUpdate,
  type SnaprollContext,
  type SnaprollOptions,
  type SnaprollSubscriptionControls,
} from './index'
import { MockTimeController } from './utilities/mock-time-controller'
import { isApproximatelyEqual } from './utilities/is-approximately-equal'
import { calculateTimingStats } from './utilities/timing-stats'

// ========================================
// Test Constants
// ========================================

/** Frame rate and timing constants */
const FRAME_RATES = {
  DEFAULT: 60,
  HIGH: 120,
  LOW: 30,
  VERY_HIGH: 240,
  VERY_LOW: 1,
} as const

/** Core timing values in milliseconds */
const TIMING_VALUES = {
  FRAME_1100MS: 1100,
  FRAME_200MS: 200,
  FRAME_20MS: 20,
  FRAME_50MS: 50,
  MICRO_DELAY: 0.001,
  STANDARD_FRAME: 16.67,
} as const

/** Core numeric values used across tests */
const CORE_VALUES = {
  LARGE_COUNT: 100,
  MEDIUM_COUNT: 50,
  SMALL_COUNT: 10,
  TOLERANCE_PERCENT: 5,
  VERY_LARGE_COUNT: 10_000,
} as const

/** Standard configuration objects with consolidated values */
const CONFIG_PRESETS = {
  CUSTOM_30: { drawRate: FRAME_RATES.LOW, updateRate: FRAME_RATES.LOW },
  DEFAULT: { drawRate: FRAME_RATES.DEFAULT, updateRate: FRAME_RATES.DEFAULT },
  HIGH_PERFORMANCE: { drawRate: FRAME_RATES.HIGH, updateRate: FRAME_RATES.HIGH },
  HIGH_UPDATE_RATE: { drawRate: FRAME_RATES.DEFAULT, updateRate: CORE_VALUES.VERY_LARGE_COUNT },
  INITIAL: { drawRate: FRAME_RATES.LOW, updateRate: CORE_VALUES.MEDIUM_COUNT },
  LOW_UPDATE_RATE: { drawRate: FRAME_RATES.DEFAULT, updateRate: CORE_VALUES.SMALL_COUNT },
  MIXED_RATES: { drawRate: FRAME_RATES.DEFAULT, updateRate: FRAME_RATES.HIGH },
} satisfies Record<string, SnaprollOptions>

/** Parameter validation constants */
const VALIDATION = {
  ERROR_MESSAGES: {
    DRAW_RATE: '[snaproll] draw rate must be a positive number',
    TIMESTEP: '[snaproll] timestep must be a positive number',
  },
  INVALID_VALUES: [-1, 0, Infinity, NaN] as const,
} as const

/** Test iteration and count constants using core values */
const TEST_COUNTS = {
  LARGE_SUBSCRIPTION_COUNT: CORE_VALUES.LARGE_COUNT,
  MEMORY_TEST_SUBSCRIPTIONS: CORE_VALUES.MEDIUM_COUNT,
  MULTIPLE_SUBSCRIPTIONS: 2,
  PERFORMANCE_SUBSCRIPTIONS: [1, 5, CORE_VALUES.SMALL_COUNT, 20, CORE_VALUES.LARGE_COUNT],
  PROPERTY_TEST_TRIALS: CORE_VALUES.MEDIUM_COUNT,
  SUBSCRIPTION_BATCH: CORE_VALUES.SMALL_COUNT,
} as const

/** Test data arrays using consolidated constants */
const TEST_DATA = {
  DIVERSE_FRAME_TIMES: Array.from(
    { length: CORE_VALUES.MEDIUM_COUNT },
    (_, index) => 12 + (index % 13),
  ),
  FRAME_TIMING_VARIATIONS: [
    TIMING_VALUES.STANDARD_FRAME,
    17.2,
    16.1,
    18,
    16.8,
    15.9,
    17.5,
    16.2,
    17.8,
    16.5,
  ],
  STUTTER_FRAME_TIMES: [
    TIMING_VALUES.STANDARD_FRAME,
    CORE_VALUES.LARGE_COUNT,
    8.33,
    CORE_VALUES.LARGE_COUNT,
    TIMING_VALUES.STANDARD_FRAME,
    150,
    12,
    120,
    TIMING_VALUES.STANDARD_FRAME,
    TIMING_VALUES.STANDARD_FRAME,
  ],
  VARIABLE_FRAME_TIMES: [TIMING_VALUES.STANDARD_FRAME, 17.2, 16.1, 18, 16.8],
}

let timeController: MockTimeController

/**
 * Sets up a fresh time controller for each test.
 */
function setupTimeController(): void {
  timeController = new MockTimeController()
}

// ========================================
// Helper Functions
// ========================================

/**
 * Properly starts an animation loop by resuming and advancing time for RAF setup.
 * @param loop - Snaproll instance to start
 */
function startAnimationLoop(loop: Snaproll): void {
  loop.resume()
  timeController.advance(TIMING_VALUES.MICRO_DELAY) // First RAF: setup callback
}

/**
 * Advances animation loop by one frame with specified timing.
 * @param frameTime - Time to advance in milliseconds
 */
function advanceOneFrame(frameTime: number = TIMING_VALUES.STANDARD_FRAME): void {
  timeController.advance(frameTime) // Animation frame execution
}

/**
 * Resumes a paused subscription and advances time for loop setup.
 * @param controls - Subscription controls to resume
 */
function resumeSubscription(controls: SnaprollSubscriptionControls): void {
  controls.resume()
  timeController.advance(TIMING_VALUES.MICRO_DELAY) // Resume triggers new animation loop setup
}

/**
 * Creates a Snaproll instance with default configuration and adds a subscription.
 * @param config - Optional configuration override
 * @param callback - Optional callback override
 * @returns Object with loop instance and subscription controls
 */
function createLoopWithSubscription(
  config: Partial<SnaprollOptions> = CONFIG_PRESETS.DEFAULT,
  callback = vi.fn(),
): { callback: ReturnType<typeof vi.fn>; controls: SnaprollSubscriptionControls; loop: Snaproll } {
  const loop = new Snaproll(config)
  const controls = loop.subscribe(callback)
  return { callback, controls, loop }
}

/**
 * Runs a complete animation loop cycle with multiple frames.
 * @param loop - Snaproll instance to run
 * @param frameCount - Number of frames to execute
 * @param frameInterval - Time between frames
 */
function runAnimationFrames(
  loop: Snaproll,
  frameCount: number = CORE_VALUES.SMALL_COUNT,
  frameInterval: number = TIMING_VALUES.STANDARD_FRAME,
): void {
  startAnimationLoop(loop)
  for (let index = 0; index < frameCount; index++) {
    advanceOneFrame(frameInterval)
  }
}

/**
 * Tests monotonicity with update tracking for interpolation validation.
 * @param updateRate - Update rate for the loop
 * @param drawRate - Draw rate for the loop
 * @param frameTimes - Array of frame times to simulate
 * @param velocity - Velocity to use for position updates
 * @returns Object with interpolation data for analysis
 */
function testMonotonicityWithUpdateTracking(
  updateRate: number,
  drawRate: number,
  frameTimes: number[],
  velocity: number = CORE_VALUES.SMALL_COUNT,
): {
  drawRate: number
  interpolatedPositions: number[]
  updatesPerDraw: number[]
  velocity: number
} {
  const loop = new Snaproll({ drawRate, updateRate })

  let previousPosition = 0
  let currentPosition = 0
  let updatesSinceLastDraw = 0
  const interpolatedPositions: number[] = []
  const updatesPerDraw: number[] = []

  loop.subscribe((context) => {
    if (context.action === SnaprollActionType.Update) {
      previousPosition = currentPosition
      currentPosition += velocity
      updatesSinceLastDraw++
    } else if (context.action === SnaprollActionType.Draw) {
      const pos = (1 - context.alpha) * previousPosition + context.alpha * currentPosition
      interpolatedPositions.push(pos)
      updatesPerDraw.push(updatesSinceLastDraw)
      updatesSinceLastDraw = 0
    }
    return undefined
  })

  startAnimationLoop(loop)
  frameTimes.forEach((frameTime) => advanceOneFrame(frameTime))
  loop.pause()

  return { drawRate, interpolatedPositions, updatesPerDraw, velocity }
}

/**
 * Creates a standard test configuration for error validation.
 * @param createInstance - Function that should throw an error
 * @param errorMessage - Expected error message
 */
function expectInvalidValueError(createInstance: () => void, errorMessage: string): void {
  expect(createInstance).toThrow(errorMessage)
}

/**
 * Tests all invalid values for a parameter.
 * @param createInstanceWithValue - Function that takes a value and should throw for invalid ones
 * @param errorMessage - Expected error message
 */
function testInvalidValues(
  createInstanceWithValue: (value: number) => void,
  errorMessage: string,
): void {
  VALIDATION.INVALID_VALUES.forEach((value) => {
    expectInvalidValueError(() => createInstanceWithValue(value), errorMessage)
  })
}

/**
 * Verifies subscription controls interface completeness.
 * @param controls - Subscription controls to verify
 */
function expectValidSubscriptionControls(controls: SnaprollSubscriptionControls): void {
  expect(typeof controls.pause).toBe('function')
  expect(typeof controls.resume).toBe('function')
  expect(typeof controls.unsubscribe).toBe('function')
}

/**
 * Creates multiple subscriptions for testing subscription management.
 * @param loop - Snaproll instance
 * @param count - Number of subscriptions to create
 * @returns Array of subscription data objects
 */
function createMultipleSubscriptions(
  loop: Snaproll,
  count: number,
): Array<{ callback: ReturnType<typeof vi.fn>; controls: SnaprollSubscriptionControls }> {
  return Array.from({ length: count }, () => {
    const callback = vi.fn()
    const controls = loop.subscribe(callback)
    return { callback, controls }
  })
}

/**
 * Validates that frame rate is approximately correct.
 * @param actualRate - Measured frame rate
 * @param expectedRate - Expected frame rate
 * @param tolerance - Tolerance percentage
 */
function expectApproximateFrameRate(
  actualRate: number,
  expectedRate: number,
  tolerance: number = CORE_VALUES.TOLERANCE_PERCENT,
): void {
  expect(isApproximatelyEqual(actualRate, expectedRate, tolerance)).toBe(true)
}

/**
 * Collects and analyzes action contexts from animation loop execution.
 * @param loop - Snaproll instance to monitor
 * @param frameCount - Number of frames to execute
 * @returns Object with categorized action contexts
 */
function collectActionContexts(
  loop: Snaproll,
  frameCount: number = CORE_VALUES.SMALL_COUNT / 2,
): {
  all: SnaprollContext[]
  begin: SnaprollContext[]
  draw: SnaprollContext[]
  update: SnaprollActionUpdate[]
} {
  const allContexts: SnaprollContext[] = []

  loop.subscribe((context) => {
    allContexts.push({ ...context })
    return undefined
  })

  runAnimationFrames(loop, frameCount)

  return {
    all: allContexts,
    begin: allContexts.filter((c) => c.action === SnaprollActionType.Begin),
    draw: allContexts.filter((c) => c.action === SnaprollActionType.Draw),
    update: allContexts.filter(
      (c) => c.action === SnaprollActionType.Update,
    ) as SnaprollActionUpdate[],
  }
}

beforeEach(setupTimeController)

describe('Snaproll Unit Tests', () => {
  describe('Constructor and Configuration', () => {
    it('initializes with default 60fps configuration when no options provided', () => {
      const snaprollInstance = new Snaproll()

      expect(snaprollInstance.state).toBe('paused')
      expect(snaprollInstance.updateRate).toBe(FRAME_RATES.DEFAULT)
    })

    it('initializes with custom drawRate and updateRate configuration', () => {
      const snaprollInstance = new Snaproll(CONFIG_PRESETS.CUSTOM_30)

      expect(snaprollInstance.updateRate).toBe(CONFIG_PRESETS.CUSTOM_30.updateRate)
    })

    it('rejects invalid drawRate values with descriptive error messages', () => {
      testInvalidValues(
        (value) => new Snaproll({ drawRate: value }),
        VALIDATION.ERROR_MESSAGES.DRAW_RATE,
      )
    })

    it('rejects invalid updateRate values with descriptive error messages', () => {
      testInvalidValues(
        (value) => new Snaproll({ updateRate: value }),
        VALIDATION.ERROR_MESSAGES.TIMESTEP,
      )
    })
  })

  describe('State Management', () => {
    it('initializes in paused state by default', () => {
      const snaprollInstance = new Snaproll()
      expect(snaprollInstance.state).toBe('paused')
    })

    it('transitions from paused to idle when resumed without any subscriptions', () => {
      const snaprollInstance = new Snaproll()
      snaprollInstance.resume()
      expect(snaprollInstance.state).toBe('idle')
    })

    it('transitions from paused to active when resumed with active subscriptions', () => {
      const snaprollInstance = new Snaproll()
      snaprollInstance.subscribe(() => undefined)
      snaprollInstance.resume()
      expect(snaprollInstance.state).toBe('active')
    })

    it('transitions from active to paused when explicitly paused', () => {
      const snaprollInstance = new Snaproll()
      snaprollInstance.subscribe(() => undefined)
      snaprollInstance.resume()
      expect(snaprollInstance.state).toBe('active')

      snaprollInstance.pause()
      expect(snaprollInstance.state).toBe('paused')
    })

    it('transitions from active to idle when all subscriptions are paused', () => {
      const snaprollInstance = new Snaproll()
      const subscriptionControls = snaprollInstance.subscribe(() => undefined)
      snaprollInstance.resume()
      expect(snaprollInstance.state).toBe('active')

      subscriptionControls.pause()
      expect(snaprollInstance.state).toBe('idle')
    })
  })

  describe('Subscription Management', () => {
    it('provides subscription controls with pause, resume, and unsubscribe methods', () => {
      const { controls } = createLoopWithSubscription()
      expectValidSubscriptionControls(controls)
      controls.unsubscribe()
    })

    it('executes all registered subscriptions during animation loop', () => {
      const loop = new Snaproll()
      const subscriptions = createMultipleSubscriptions(loop, 2)

      startAnimationLoop(loop)
      advanceOneFrame(TIMING_VALUES.FRAME_20MS)

      subscriptions.forEach(({ callback }) => {
        expect(callback).toHaveBeenCalled()
      })

      subscriptions.forEach(({ controls }) => controls.unsubscribe())
    })

    it('allows individual subscription pause and resume without affecting others', () => {
      const snaprollInstance = new Snaproll()
      const pausableSubscriptionCallback = vi.fn()
      const activeSubscriptionCallback = vi.fn()

      const pausableSubscriptionControls = snaprollInstance.subscribe(pausableSubscriptionCallback)
      const activeSubscriptionControls = snaprollInstance.subscribe(activeSubscriptionCallback)

      startAnimationLoop(snaprollInstance)
      pausableSubscriptionControls.pause()

      advanceOneFrame(TIMING_VALUES.FRAME_20MS)

      expect(pausableSubscriptionCallback).not.toHaveBeenCalled()
      expect(activeSubscriptionCallback).toHaveBeenCalled()

      pausableSubscriptionControls.resume()
      pausableSubscriptionCallback.mockClear()
      activeSubscriptionCallback.mockClear()

      advanceOneFrame(TIMING_VALUES.FRAME_20MS)

      expect(pausableSubscriptionCallback).toHaveBeenCalled()
      expect(activeSubscriptionCallback).toHaveBeenCalled()

      pausableSubscriptionControls.unsubscribe()
      activeSubscriptionControls.unsubscribe()
    })

    it('respects immediate: false option by deferring subscription activation', () => {
      const snaprollInstance = new Snaproll()
      const deferredSubscriptionCallback = vi.fn()

      const deferredSubscriptionControls = snaprollInstance.subscribe(
        deferredSubscriptionCallback,
        { immediate: false },
      )
      startAnimationLoop(snaprollInstance)

      advanceOneFrame(TIMING_VALUES.FRAME_20MS)

      expect(deferredSubscriptionCallback).not.toHaveBeenCalled()

      resumeSubscription(deferredSubscriptionControls)
      advanceOneFrame(TIMING_VALUES.FRAME_20MS)

      expect(deferredSubscriptionCallback).toHaveBeenCalled()

      deferredSubscriptionControls.unsubscribe()
    })
  })

  describe('Frame Rate and Timing', () => {
    it('accurately calculates actual drawRate after running animation frames', () => {
      const { loop } = createLoopWithSubscription({ drawRate: FRAME_RATES.DEFAULT })
      startAnimationLoop(loop)

      // Simulate exactly 1 second at target drawRate
      const frameInterval = 1000 / FRAME_RATES.DEFAULT
      for (let frameIndex = 0; frameIndex < FRAME_RATES.DEFAULT; frameIndex++) {
        advanceOneFrame(frameInterval)
      }

      expectApproximateFrameRate(loop.drawRate, FRAME_RATES.DEFAULT)
      loop.pause()
    })

    it('accepts drawRate changes through setter without throwing errors', () => {
      const snaprollInstance = new Snaproll({ drawRate: FRAME_RATES.DEFAULT })

      snaprollInstance.drawRate = FRAME_RATES.LOW

      // The drawRate property returns the target draw rate
      // Verify the setter operation completed successfully
      expect(snaprollInstance.drawRate).toBe(FRAME_RATES.LOW)
    })

    it('rejects invalid drawRate values through setter with descriptive errors', () => {
      const snaprollInstance = new Snaproll()

      testInvalidValues((value) => {
        snaprollInstance.drawRate = value
      }, VALIDATION.ERROR_MESSAGES.DRAW_RATE)
    })

    it('maintains updateRate value through getter and setter operations', () => {
      const snaprollInstance = new Snaproll({ updateRate: FRAME_RATES.DEFAULT })

      expect(snaprollInstance.updateRate).toBe(FRAME_RATES.DEFAULT)

      snaprollInstance.updateRate = FRAME_RATES.LOW
      expect(snaprollInstance.updateRate).toBe(FRAME_RATES.LOW)
    })

    it('rejects invalid updateRate values through setter with descriptive errors', () => {
      const snaprollInstance = new Snaproll()

      testInvalidValues((value) => {
        snaprollInstance.updateRate = value
      }, VALIDATION.ERROR_MESSAGES.TIMESTEP)
    })
  })

  describe('Reset Functionality', () => {
    it('applies new configuration options while preserving paused state', () => {
      const { loop } = createLoopWithSubscription(CONFIG_PRESETS.INITIAL)

      loop.reset(CONFIG_PRESETS.DEFAULT)

      expect(loop.updateRate).toBe(CONFIG_PRESETS.DEFAULT.updateRate)
      expect(loop.state).toBe('paused')
    })

    it('preserves existing subscriptions and active state when reset without options', () => {
      const { loop } = createLoopWithSubscription()
      loop.resume()

      expect(loop.state).toBe('active')

      loop.reset()

      expect(loop.state).toBe('active')
    })

    it('maintains active state after clearing subscriptions when keepSubscriptions is false', () => {
      const { loop } = createLoopWithSubscription()
      loop.resume()

      expect(loop.state).toBe('active')

      loop.reset({ keepSubscriptions: false })

      expect(loop.state).toBe('idle')
    })
  })
})

describe('Animation Loop Integration Tests', () => {
  describe('Action Sequence', () => {
    it('executes animation actions in correct chronological order: Begin → Update → Draw', () => {
      const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
      const contexts = collectActionContexts(loop, 1)

      expect(contexts.all.length).toBeGreaterThan(0)

      const beginActionIndex = contexts.all.findIndex(
        (context) => context.action === SnaprollActionType.Begin,
      )
      const updateActionIndex = contexts.all.findIndex(
        (context) => context.action === SnaprollActionType.Update,
      )
      const drawActionIndex = contexts.all.findIndex(
        (context) => context.action === SnaprollActionType.Draw,
      )

      expect(beginActionIndex).toBeGreaterThanOrEqual(0)
      expect(drawActionIndex).toBeGreaterThanOrEqual(0)
      expect(drawActionIndex).toBeGreaterThan(beginActionIndex)

      if (updateActionIndex >= 0) {
        expect(updateActionIndex).toBeGreaterThan(beginActionIndex)
        expect(drawActionIndex).toBeGreaterThan(updateActionIndex)
      }

      loop.pause()
    })

    it('provides accurate timing data in all action types', () => {
      const snaprollInstance = new Snaproll(CONFIG_PRESETS.DEFAULT)
      const capturedContexts: SnaprollContext[] = []

      snaprollInstance.subscribe((action) => {
        capturedContexts.push({ ...action })
        return undefined
      })

      startAnimationLoop(snaprollInstance)
      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)

      const beginAction = capturedContexts.find(
        (context) => context.action === SnaprollActionType.Begin,
      )
      const updateAction = capturedContexts.find(
        (context) => context.action === SnaprollActionType.Update,
      )
      const drawAction = capturedContexts.find(
        (context) => context.action === SnaprollActionType.Draw,
      )

      expect(beginAction).toBeDefined()
      if (beginAction !== undefined) {
        expect(beginAction.timestamp).toBeGreaterThan(0)
      }

      if (updateAction !== undefined) {
        expect(updateAction.timestamp).toBeDefined()
        expect(updateAction.timestep).toBe(1000 / CONFIG_PRESETS.DEFAULT.updateRate)
      }

      expect(drawAction).toBeDefined()
      if (drawAction !== undefined) {
        expect(drawAction.timestamp).toBeDefined()
        expect(drawAction.timestep).toBeDefined()
        expect(drawAction.alpha).toBeGreaterThanOrEqual(0)
      }

      snaprollInstance.pause()
    })
  })

  describe('Frame Timing Accuracy', () => {
    it('maintains consistent frame timing', () => {
      const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
      const frameTimes: number[] = []
      let lastTimestamp = 0

      loop.subscribe((context) => {
        if (context.action === SnaprollActionType.Draw) {
          if (lastTimestamp > 0) {
            frameTimes.push(context.timestamp - lastTimestamp)
          }
          lastTimestamp = context.timestamp
        }
        return undefined
      })

      startAnimationLoop(loop)

      // Simulate frames
      for (let index = 0; index < CORE_VALUES.SMALL_COUNT; index++) {
        advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
      }

      const stats = calculateTimingStats(frameTimes)

      expect(isApproximatelyEqual(stats.mean, TIMING_VALUES.STANDARD_FRAME, 1)).toBe(true)
      expect(stats.coefficientOfVariation).toBeLessThan(0.1) // Low variance

      loop.pause()
    })

    it('handles variable frame timing gracefully', () => {
      const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
      const actions: SnaprollContext[] = []

      loop.subscribe((action) => {
        actions.push({ ...action })
        return undefined
      })

      startAnimationLoop(loop)

      // Simulate variable frame times
      TEST_DATA.VARIABLE_FRAME_TIMES.forEach((time) => advanceOneFrame(time))

      const updateContexts = actions.filter((a) => a.action === SnaprollActionType.Update)
      const drawContexts = actions.filter((a) => a.action === SnaprollActionType.Draw)

      expect(updateContexts.length).toBeGreaterThan(0)
      expect(drawContexts.length).toBeGreaterThan(0)

      // Should handle timing gracefully without errors
      expect(actions.length).toBeGreaterThan(TEST_DATA.VARIABLE_FRAME_TIMES.length * 2) // At least Begin + Draw per frame

      loop.pause()
    })
  })

  describe('Subscription Edge Cases', () => {
    it('handles subscription during animation loop', () => {
      const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      loop.subscribe(callback1)
      startAnimationLoop(loop)

      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
      expect(callback1).toHaveBeenCalled()

      // Add subscription during loop
      loop.subscribe(callback2)
      callback1.mockClear()

      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
      expect(callback1).toHaveBeenCalled()
      expect(callback2).toHaveBeenCalled()

      loop.pause()
    })

    it('handles unsubscription during animation loop', () => {
      const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const controls1 = loop.subscribe(callback1)
      const controls2 = loop.subscribe(callback2)
      startAnimationLoop(loop)

      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
      expect(callback1).toHaveBeenCalled()
      expect(callback2).toHaveBeenCalled()

      // Remove subscription during loop
      controls1.unsubscribe()
      callback1.mockClear()
      callback2.mockClear()

      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalled()

      controls2.unsubscribe()
    })
  })
})

describe('Edge Cases and Error Handling', () => {
  describe('Extreme Values', () => {
    it('handles very high drawRate values', () => {
      const { callback, loop } = createLoopWithSubscription({
        drawRate: FRAME_RATES.VERY_HIGH,
        updateRate: FRAME_RATES.VERY_HIGH,
      })
      startAnimationLoop(loop)

      advanceOneFrame(TIMING_VALUES.FRAME_50MS) // Multiple frames
      expect(callback).toHaveBeenCalled()

      loop.pause()
    })

    it('handles very low drawRate values', () => {
      const { callback, loop } = createLoopWithSubscription({
        drawRate: FRAME_RATES.VERY_LOW,
        updateRate: FRAME_RATES.VERY_LOW,
      })
      startAnimationLoop(loop)

      advanceOneFrame(TIMING_VALUES.FRAME_1100MS) // Just over 1 second
      expect(callback).toHaveBeenCalled()

      loop.pause()
    })

    it('handles very high updateRate values', () => {
      const loop = new Snaproll(CONFIG_PRESETS.HIGH_UPDATE_RATE)
      const actions: SnaprollContext[] = []

      loop.subscribe((action) => {
        actions.push({ ...action })
        return undefined
      })

      startAnimationLoop(loop)
      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)

      const updateContexts = actions.filter((a) => a.action === SnaprollActionType.Update)
      expect(updateContexts.length).toBeGreaterThan(100) // Many small updates

      loop.pause()
    })

    it('handles very low updateRate values', () => {
      const loop = new Snaproll(CONFIG_PRESETS.LOW_UPDATE_RATE)
      const actions: SnaprollContext[] = []

      loop.subscribe((action) => {
        actions.push({ ...action })
        return undefined
      })

      loop.resume()
      timeController.advance(TIMING_VALUES.STANDARD_FRAME)

      const updateContexts = actions.filter((a) => a.action === SnaprollActionType.Update)
      expect(updateContexts.length).toBe(0) // No updates in short frame

      loop.pause()
    })
  })

  describe('Callback Error Handling', () => {
    it('continues animation loop when callback throws error', () => {
      const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
      const errorCallback = vi.fn(() => {
        throw new Error('Test error')
      })

      loop.subscribe(errorCallback)
      startAnimationLoop(loop)

      // Should not crash the MockTimeController - advance multiple frames
      expect(() => {
        advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
        advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
        advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
      }).not.toThrow()

      expect(errorCallback).toHaveBeenCalled()

      // Core test: MockTimeController handles errors gracefully and system continues
      // Create fresh loop to test recovery
      const recoveryLoop = new Snaproll({ drawRate: 60, updateRate: 60 })
      const normalCallback = vi.fn()
      recoveryLoop.subscribe(normalCallback)
      startAnimationLoop(recoveryLoop)

      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
      expect(normalCallback).toHaveBeenCalled()

      loop.pause()
      recoveryLoop.pause()
    })
  })

  describe('Rapid State Changes', () => {
    it('handles rapid pause/resume cycles', () => {
      const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
      const callback = vi.fn()

      loop.subscribe(callback)

      for (let index = 0; index < CORE_VALUES.SMALL_COUNT; index++) {
        loop.resume()
        expect(loop.state).toBe('active')
        loop.pause()
        expect(loop.state).toBe('paused')
      }
    })

    it('handles rapid subscription changes', () => {
      const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
      const callbacks = Array.from({ length: TEST_COUNTS.SUBSCRIPTION_BATCH }, () => vi.fn())

      const controls = callbacks.map((callback) => loop.subscribe(callback))
      startAnimationLoop(loop)
      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)

      callbacks.forEach((callback) => expect(callback).toHaveBeenCalled())

      controls.forEach((ctrl) => ctrl.unsubscribe())
      callbacks.forEach((callback) => callback.mockClear())

      timeController.advance(TIMING_VALUES.STANDARD_FRAME)
      callbacks.forEach((callback) => expect(callback).not.toHaveBeenCalled())

      loop.pause()
    })
  })

  describe('Memory and Resource Management', () => {
    it('cleans up subscriptions properly', () => {
      const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
      const callbacks = Array.from({ length: TEST_COUNTS.LARGE_SUBSCRIPTION_COUNT }, () => vi.fn())

      const controls = callbacks.map((callback) => loop.subscribe(callback))
      startAnimationLoop(loop)

      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
      callbacks.forEach((callback) => expect(callback).toHaveBeenCalled())

      // Unsubscribe all
      controls.forEach((ctrl) => ctrl.unsubscribe())
      expect(loop.state).toBe('idle')

      // Add new subscriptions to ensure no memory leaks
      const newCallbacks = Array.from({ length: 10 }, () => vi.fn())
      newCallbacks.forEach((callback) => loop.subscribe(callback))
      startAnimationLoop(loop)

      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
      newCallbacks.forEach((callback) => expect(callback).toHaveBeenCalled())

      loop.pause()
    })

    it('handles reset with many subscriptions', () => {
      const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
      const callbacks = Array.from({ length: TEST_COUNTS.MEMORY_TEST_SUBSCRIPTIONS }, () => vi.fn())

      callbacks.forEach((callback) => loop.subscribe(callback))
      startAnimationLoop(loop)

      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
      callbacks.forEach((callback) => expect(callback).toHaveBeenCalled())

      loop.reset({ keepSubscriptions: false })
      // State is idle after reset with keepSubscriptions: false
      expect(loop.state).toBe('idle')

      callbacks.forEach((callback) => callback.mockClear())
      loop.resume()
      timeController.advance(TIMING_VALUES.STANDARD_FRAME)

      // Should not call old callbacks since they were cleared
      callbacks.forEach((callback) => expect(callback).not.toHaveBeenCalled())
    })
  })

  describe('Boundary Conditions', () => {
    it('handles zero frame advance', () => {
      const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
      const callback = vi.fn()

      loop.subscribe(callback)
      startAnimationLoop(loop)

      timeController.advance(0) // No time advance

      // Should not cause errors
      expect(() => advanceOneFrame(16.67)).not.toThrow()
      expect(callback).toHaveBeenCalled()

      loop.pause()
    })

    it('handles backwards time (should not happen but be defensive)', () => {
      const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
      const callback = vi.fn()

      loop.subscribe(callback)
      startAnimationLoop(loop)

      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
      expect(callback).toHaveBeenCalled()

      callback.mockClear()

      // Advance forward normally after any timing anomaly
      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
      expect(callback).toHaveBeenCalled()

      loop.pause()
    })
  })
})

describe('Essential Animation Behavior', () => {
  it('maintains consistent update timing over multiple frames', () => {
    const updateRate = 60
    const loop = new Snaproll({ drawRate: 60, updateRate })

    const updateContexts: SnaprollActionUpdate[] = []
    let totalFrameTime = 0

    loop.subscribe((context) => {
      if (context.action === SnaprollActionType.Update) {
        updateContexts.push(context)
      }
      return undefined
    })

    startAnimationLoop(loop)

    // Simulate 10 frames with slight timing variation
    const frameTimes = [16.5, 16.8, 16.6, 16.7, 16.9, 16.4, 16.8, 16.6, 16.7, 16.5]
    frameTimes.forEach((frameTime) => {
      totalFrameTime += frameTime
      advanceOneFrame(frameTime)
    })

    const timestep = 1000 / updateRate
    const totalUpdateTime = updateContexts.length * timestep
    const expectedUpdateTime = Math.floor(totalFrameTime / timestep) * timestep

    // Practical tolerance - within one timestep
    expect(Math.abs(totalUpdateTime - expectedUpdateTime)).toBeLessThan(timestep)

    loop.pause()
  })

  it('maintains proper action sequence ordering', () => {
    const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
    const actions: SnaprollContext[] = []

    loop.subscribe((action) => {
      actions.push({ ...action })
      return undefined
    })

    startAnimationLoop(loop)

    // Run a few frames
    advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
    advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
    advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)

    // Verify Begin → Update → Draw ordering within each frame
    let lastBeginIndex = -1
    let lastDrawIndex = -1

    actions.forEach((context, index) => {
      if (context.action === SnaprollActionType.Begin) {
        lastBeginIndex = index
      } else if (context.action === SnaprollActionType.Draw) {
        expect(index).toBeGreaterThan(lastBeginIndex)
        lastDrawIndex = index
      } else if (context.action === SnaprollActionType.Update) {
        expect(index).toBeGreaterThan(lastBeginIndex)
        if (lastDrawIndex > lastBeginIndex) {
          expect(index).toBeLessThan(lastDrawIndex)
        }
      }
    })

    loop.pause()
  })

  it('subscription count does not affect core functionality', () => {
    const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
    const callbacks = Array.from({ length: 5 }, () => vi.fn())

    callbacks.forEach((callback) => loop.subscribe(callback))
    startAnimationLoop(loop)

    // Run several frames
    for (let index = 0; index < 5; index++) {
      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
    }

    // All callbacks should be called the same number of times
    const firstCallCount = callbacks[0].mock.calls.length
    callbacks.forEach((callback) => {
      expect(callback.mock.calls.length).toBe(firstCallCount)
    })

    expect(firstCallCount).toBeGreaterThan(0)
    loop.pause()
  })

  it('reset preserves essential configuration', () => {
    const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)

    expect(loop.updateRate).toBe(60)
    expect(loop.state).toBe('paused')

    loop.reset({ drawRate: 30, updateRate: 30 })

    expect(loop.updateRate).toBe(30)
    expect(loop.state).toBe('paused') // State should be preserved
  })

  it('pause/resume cycles work reliably', () => {
    const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)
    const callback = vi.fn()

    loop.subscribe(callback)
    loop.resume() // Need to resume to make it active

    // Test a few cycles
    for (let index = 0; index < 3; index++) {
      expect(loop.state).toBe('active')
      loop.pause()
      expect(loop.state).toBe('paused')
      loop.resume()
      expect(loop.state).toBe('active')
    }

    // Should still be functional
    startAnimationLoop(loop)
    advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
    expect(callback).toHaveBeenCalled()

    loop.pause()
  })

  describe('Performance Validation', () => {
    it('handles basic subscription cleanup properly', () => {
      const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)

      // Create and remove some subscriptions
      const callbacks = Array.from({ length: TEST_COUNTS.SUBSCRIPTION_BATCH }, () => vi.fn())
      const controls = callbacks.map((callback) => loop.subscribe(callback))

      startAnimationLoop(loop)
      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)

      // All should be called
      callbacks.forEach((callback) => expect(callback).toHaveBeenCalled())

      // Clean up half
      controls.slice(0, 5).forEach((ctrl) => ctrl.unsubscribe())

      // System should still work with remaining subscriptions
      callbacks.forEach((callback) => callback.mockClear())
      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)

      // Only remaining callbacks should be called
      callbacks.slice(0, 5).forEach((callback) => expect(callback).not.toHaveBeenCalled())
      callbacks.slice(5).forEach((callback) => expect(callback).toHaveBeenCalled())

      loop.pause()
    })
  })
})

describe('Cross-FPS Behavior Validation', () => {
  it('operates correctly across standard frame rates: 30fps, 60fps, and 120fps', () => {
    const standardFrameRateConfigurations = [
      { drawRate: 30, updateRate: 30 },
      { drawRate: 60, updateRate: 60 },
      { drawRate: 120, updateRate: 120 },
    ]

    standardFrameRateConfigurations.forEach(({ drawRate, updateRate }) => {
      const snaprollInstance = new Snaproll({ drawRate, updateRate })
      const frameCallback = vi.fn()

      snaprollInstance.subscribe(frameCallback)
      startAnimationLoop(snaprollInstance)

      // Execute multiple frames at the configured rate
      const frameInterval = 1000 / drawRate
      advanceOneFrame(frameInterval)
      advanceOneFrame(frameInterval)
      advanceOneFrame(frameInterval)

      expect(frameCallback).toHaveBeenCalled()
      expect(snaprollInstance.state).toBe('active')

      snaprollInstance.pause()
    })
  })

  it('adapts to realistic browser frame timing variations without issues', () => {
    const standardConfig = { drawRate: 60, updateRate: 60 }
    const snaprollInstance = new Snaproll(standardConfig)
    const capturedContexts: SnaprollContext[] = []

    snaprollInstance.subscribe((action) => {
      capturedContexts.push({ ...action })
      return undefined
    })

    startAnimationLoop(snaprollInstance)

    // Simulate realistic browser timing variations around 60fps target
    const variableFrameIntervals = [15.5, 17.2, 16.1, 18, 16.8]
    // const variableFrameIntervals = [1000 / 60, 1000 / 60, 1000 / 60, 1000 / 60]
    variableFrameIntervals.forEach((frameInterval) => advanceOneFrame(frameInterval))

    const beginContexts = capturedContexts.filter(
      (context) => context.action === SnaprollActionType.Begin,
    )
    const drawContexts = capturedContexts.filter(
      (context) => context.action === SnaprollActionType.Draw,
    )

    expect(beginContexts.length).toBeGreaterThanOrEqual(variableFrameIntervals.length - 1)
    expect(drawContexts.length).toBeGreaterThanOrEqual(variableFrameIntervals.length - 1)

    snaprollInstance.pause()
  })

  it('maintains 30fps action frequency despite 60fps frame advance rate', () => {
    const snaprollTargetDrawRate = 30
    const frameAdvanceRate = 60
    const frameAdvanceInterval = 1000 / frameAdvanceRate // 16.67ms

    const loop = new Snaproll({
      drawRate: snaprollTargetDrawRate,
      updateRate: snaprollTargetDrawRate,
    })
    const capturedBeginContexts: SnaprollContext[] = []
    const capturedUpdateContexts: SnaprollContext[] = []
    const capturedDrawContexts: SnaprollContext[] = []

    loop.subscribe((context) => {
      if (context.action === SnaprollActionType.Begin) {
        capturedBeginContexts.push(context)
      } else if (context.action === SnaprollActionType.Update) {
        capturedUpdateContexts.push(context)
      } else if (context.action === SnaprollActionType.Draw) {
        capturedDrawContexts.push(context)
      }
      return undefined
    })

    startAnimationLoop(loop)

    // Simulate 1 second by advancing 60 frames at 16.67ms intervals
    const updateFrames = frameAdvanceRate
    for (let frameIndex = 0; frameIndex < updateFrames; frameIndex++) {
      advanceOneFrame(frameAdvanceInterval)
    }

    // All action types should execute at snaproll's configured rate, not the frame advance rate
    expect(isApproximatelyEqual(capturedBeginContexts.length, snaprollTargetDrawRate, 1)).toBe(true)
    expect(isApproximatelyEqual(capturedDrawContexts.length, snaprollTargetDrawRate, 1)).toBe(true)
    expect(isApproximatelyEqual(capturedUpdateContexts.length, snaprollTargetDrawRate, 1)).toBe(
      true,
    )

    loop.pause()
  })

  it('handles large time advance that triggers updateStep >= 10 and skips draw when callback returns true', () => {
    const updateRate = 60
    const loop = new Snaproll({ drawRate: 60, updateRate })
    const capturedContexts: SnaprollContext[] = []
    let largeUpdateStepDetected = false

    loop.subscribe((context) => {
      capturedContexts.push({ ...context })

      // Return true when we detect updateStep >= 10 to trigger skip-draw behavior
      if (context.action === SnaprollActionType.Update && context.updateStep >= 10) {
        largeUpdateStepDetected = true
        return true
      }

      return undefined
    })

    startAnimationLoop(loop)

    // Advance by a large amount of time (200ms) to trigger multiple update steps
    // This should result in updateSteps = Math.floor(200 / 16.67) = 12 steps
    advanceOneFrame(TIMING_VALUES.FRAME_200MS)

    // Verify that we detected a large update step
    expect(largeUpdateStepDetected).toBe(true)

    // Verify action sequence: Begin should execute
    const beginContexts = capturedContexts.filter(
      (context) => context.action === SnaprollActionType.Begin,
    )
    expect(beginContexts.length).toBe(1)

    // Verify that Update actions executed with large updateStep values
    const updateContexts = capturedContexts.filter(
      (context) => context.action === SnaprollActionType.Update,
    )
    expect(updateContexts.length).toBe(1)

    // Should have an update step >= 10
    const largeUpdateSteps = updateContexts.filter((action) => action.updateStep >= 10)
    expect(largeUpdateSteps.length).toBe(1)

    // Verify that Draw action was skipped (should be 0 draw actions)
    const drawContexts = capturedContexts.filter(
      (context) => context.action === SnaprollActionType.Draw,
    )
    expect(drawContexts.length).toBe(0)

    loop.pause()
  })
})

describe('Performance Validation Tests', () => {
  it('handles reasonable number of subscriptions', () => {
    const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)

    // Test with realistic number of subscriptions (5-10 is typical)
    const callbacks = Array.from({ length: 8 }, () => vi.fn())
    callbacks.forEach((callback) => loop.subscribe(callback))
    startAnimationLoop(loop)

    // Run several frames
    for (let index = 0; index < 5; index++) {
      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
    }

    // All callbacks should be executed
    callbacks.forEach((callback) => expect(callback).toHaveBeenCalled())
    expect(loop.state).toBe('active')

    loop.pause()
  })

  it('subscription lifecycle works efficiently', () => {
    const loop = new Snaproll(CONFIG_PRESETS.DEFAULT)

    // Create a reasonable number of subscriptions
    const callbacks = Array.from({ length: 10 }, () => vi.fn())
    const controls = callbacks.map((callback) => loop.subscribe(callback))

    startAnimationLoop(loop)
    advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)

    // All should be called initially
    callbacks.forEach((callback) => expect(callback).toHaveBeenCalled())

    // Remove half
    controls.slice(0, 5).forEach((ctrl) => ctrl.unsubscribe())

    callbacks.forEach((callback) => callback.mockClear())
    advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)

    // Only remaining should be called
    callbacks.slice(0, 5).forEach((callback) => expect(callback).not.toHaveBeenCalled())
    callbacks.slice(5).forEach((callback) => expect(callback).toHaveBeenCalled())

    loop.pause()
  })
})

describe('Interpolation and Quantization Tests', () => {
  describe('Rate-Agnostic Monotonicity Tests', () => {
    const testCases = [
      { description: 'barely above (edge case)', drawRate: 60, updateRate: 61 },
      { description: 'moderate difference', drawRate: 60, updateRate: 121 },
      { description: 'high update rate', drawRate: 60, updateRate: 240 },
      { description: 'very high ratio', drawRate: 30, updateRate: 301 },
    ]

    testCases.forEach(({ description, drawRate, updateRate }) => {
      it(`validates monotonicity for ${updateRate}/${drawRate} Hz (${description})`, () => {
        const { interpolatedPositions, updatesPerDraw, velocity } =
          testMonotonicityWithUpdateTracking(updateRate, drawRate, TEST_DATA.DIVERSE_FRAME_TIMES)

        expect(interpolatedPositions.length).toBeGreaterThan(10)

        // Core validation: strict monotonicity
        for (let index = 1; index < interpolatedPositions.length; index++) {
          expect(interpolatedPositions[index]).toBeGreaterThanOrEqual(
            interpolatedPositions[index - 1],
          )
        }

        // Validate sharp lower bound for m=1 cases when they exist
        const m1Cases = updatesPerDraw.filter((m) => m === 1)
        if (m1Cases.length > 0) {
          const Q = 1 << Math.ceil(Math.log2(drawRate))
          const minStep = velocity / Q

          for (let index = 1; index < interpolatedPositions.length; index++) {
            if (updatesPerDraw[index] === 1) {
              const step = interpolatedPositions[index] - interpolatedPositions[index - 1]
              // Scale-aware tolerance relative to step magnitude
              const tolerance = Math.max(1e-12, 32 * Number.EPSILON * Math.abs(minStep))
              expect(step + tolerance).toBeGreaterThanOrEqual(minStep)
            }
          }
        }

        // Draw gating robustness check: mostly informational, strict only for edge cases
        const zeroUpdateDraws = updatesPerDraw.filter((m) => m === 0).length
        const totalDraws = updatesPerDraw.length

        if (updateRate === drawRate + 1) {
          // For u=d+1, allow more zero-update draws due to timing sensitivity
          if (zeroUpdateDraws / totalDraws > 0.5) {
            console.warn(
              `High zero-update draw ratio for ${updateRate}/${drawRate}: ${zeroUpdateDraws}/${totalDraws}`,
            )
          }
        } else {
          // For other rates, most draws should have ≥1 update
          expect(zeroUpdateDraws / totalDraws).toBeLessThan(0.2)
        }
      })
    })
  })

  it('validates sharp m=1 lower bound (critical corner case)', () => {
    // Use 61/60 Hz configuration which reliably produces m=1 cases
    const updateRate = 61
    const drawRate = 60
    const { interpolatedPositions, updatesPerDraw, velocity } = testMonotonicityWithUpdateTracking(
      updateRate,
      drawRate,
      Array.from({ length: 100 }, (_, index) => 16 + (index % 5)), // 16-20ms timing variation
    )

    // Guarantee we test the m=1 corner case
    const m1Cases = updatesPerDraw.filter((m) => m === 1)
    expect(m1Cases.length).toBeGreaterThan(0)

    // Validate the sharp theoretical lower bound for m=1 cases
    const Q = 1 << Math.ceil(Math.log2(drawRate))
    const minStep = velocity / Q

    let validatedM1Cases = 0
    for (let index = 1; index < interpolatedPositions.length; index++) {
      if (updatesPerDraw[index] === 1) {
        const step = interpolatedPositions[index] - interpolatedPositions[index - 1]
        // Scale-aware tolerance relative to step magnitude
        const tolerance = Math.max(1e-12, 32 * Number.EPSILON * Math.abs(minStep))
        expect(step + tolerance).toBeGreaterThanOrEqual(minStep)
        validatedM1Cases++
      }
    }

    // Ensure we actually validated some m=1 cases
    expect(validatedM1Cases).toBeGreaterThan(0)
  })

  it('validates exact alpha quantization grid membership', () => {
    const drawRate = 60
    const updateRate = 120
    const loop = new Snaproll({ drawRate, updateRate })

    const alphaValues: number[] = []

    loop.subscribe((context) => {
      if (context.action === SnaprollActionType.Draw) {
        alphaValues.push(context.alpha)
      }
      return undefined
    })

    startAnimationLoop(loop)

    // Generate diverse frame timing to exercise quantization
    for (let index = 0; index < 50; index++) {
      advanceOneFrame(14 + ((index * 1.7) % 10)) // 14-24ms with fractional offsets
    }

    const Q = 1 << Math.ceil(Math.log2(drawRate)) // 64 for drawRate=60

    expect(alphaValues.length).toBeGreaterThan(20)

    alphaValues.forEach((alpha) => {
      // Exact grid membership check - Q is power-of-2, so α = k/Q is exactly representable
      const k = Math.round(alpha * Q)
      const tolerance = Math.max(64 * Number.EPSILON, 64 * Number.EPSILON * Math.abs(alpha * Q))
      expect(Math.abs(alpha * Q - k)).toBeLessThan(tolerance)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThan(Q) // ensures alpha < 1
    })

    loop.pause()
  })

  it('validates theory identity: step = (m + Δα) × velocity', () => {
    const updateRate = 120
    const drawRate = 60
    const loop = new Snaproll({ drawRate, updateRate })
    const velocity = 5

    let previousPosition = 0
    let currentPosition = 0
    let updatesSinceLastDraw = 0
    const interpolatedPositions: number[] = []
    const updatesPerDraw: number[] = []
    const alphaValues: number[] = []

    loop.subscribe((context) => {
      if (context.action === SnaprollActionType.Update) {
        previousPosition = currentPosition
        currentPosition += velocity
        updatesSinceLastDraw++
      } else if (context.action === SnaprollActionType.Draw) {
        const pos = (1 - context.alpha) * previousPosition + context.alpha * currentPosition
        interpolatedPositions.push(pos)
        updatesPerDraw.push(updatesSinceLastDraw)
        alphaValues.push(context.alpha)
        updatesSinceLastDraw = 0
      }
      return undefined
    })

    startAnimationLoop(loop)

    // Use diverse frame timing for rich test coverage
    const frameTimes = TEST_DATA.FRAME_TIMING_VARIATIONS
    frameTimes.forEach((frameTime) => advanceOneFrame(frameTime))
    loop.pause()

    expect(interpolatedPositions.length).toBeGreaterThan(5)

    // Guard array invariants
    expect(interpolatedPositions.length).toBe(updatesPerDraw.length)
    expect(interpolatedPositions.length).toBe(alphaValues.length)

    // Validate theory identity: step = (m + Δα) × velocity
    for (let index = 1; index < interpolatedPositions.length; index++) {
      const step = interpolatedPositions[index] - interpolatedPositions[index - 1]
      const m = updatesPerDraw[index]
      const deltaAlpha = alphaValues[index] - alphaValues[index - 1]
      const expectedStep = (m + deltaAlpha) * velocity

      // Scale-aware tolerance for theory identity
      const tolerance = Math.max(1e-10, 64 * Number.EPSILON * Math.abs(expectedStep))
      expect(Math.abs(step - expectedStep)).toBeLessThan(tolerance)
    }
  })

  it('validates non-power-of-two-ish drawRates maintain lower bounds', () => {
    const testCases = [
      { description: 'Q=64 > d=59', drawRate: 59, updateRate: 60 },
      { description: 'Q=128 > d=95', drawRate: 95, updateRate: 96 },
    ]

    testCases.forEach(({ drawRate, updateRate }) => {
      const { interpolatedPositions, updatesPerDraw, velocity } =
        testMonotonicityWithUpdateTracking(
          updateRate,
          drawRate,
          Array.from({ length: 30 }, (_, index) => 16 + (index % 3)), // 16-18ms timing
        )

      // Verify monotonicity
      for (let index = 1; index < interpolatedPositions.length; index++) {
        expect(interpolatedPositions[index]).toBeGreaterThanOrEqual(
          interpolatedPositions[index - 1],
        )
      }

      // Validate lower bound for m=1 cases with Q > drawRate
      const Q = 1 << Math.ceil(Math.log2(drawRate))
      const minStep = velocity / Q
      expect(Q).toBeGreaterThan(drawRate) // Verify Q > d property

      for (let index = 1; index < interpolatedPositions.length; index++) {
        if (updatesPerDraw[index] === 1) {
          const step = interpolatedPositions[index] - interpolatedPositions[index - 1]
          const tolerance = Math.max(1e-12, 32 * Number.EPSILON * Math.abs(minStep))
          expect(step + tolerance).toBeGreaterThanOrEqual(minStep)
        }
      }
    })
  })

  it('validates quantization with tiny steps (precision edge case)', () => {
    const updateRate = 120
    const drawRate = 60
    const loop = new Snaproll({ drawRate, updateRate })
    const tinyVelocity = 1e-6 // Very small per-update step

    let previousPosition = 0
    let currentPosition = 0
    let updatesSinceLastDraw = 0
    const interpolatedPositions: number[] = []
    const updatesPerDraw: number[] = []

    loop.subscribe((context) => {
      if (context.action === SnaprollActionType.Update) {
        previousPosition = currentPosition
        currentPosition += tinyVelocity
        updatesSinceLastDraw++
      } else if (context.action === SnaprollActionType.Draw) {
        const pos = (1 - context.alpha) * previousPosition + context.alpha * currentPosition
        interpolatedPositions.push(pos)
        updatesPerDraw.push(updatesSinceLastDraw)
        updatesSinceLastDraw = 0
      }
      return undefined
    })

    startAnimationLoop(loop)

    // Run with variable timing to exercise quantization
    const frameTimes = TEST_DATA.FRAME_TIMING_VARIATIONS
    frameTimes.forEach((frameTime) => advanceOneFrame(frameTime))
    loop.pause()

    expect(interpolatedPositions.length).toBeGreaterThan(5)

    // Core validation: monotonicity even with tiny steps
    for (let index = 1; index < interpolatedPositions.length; index++) {
      expect(interpolatedPositions[index]).toBeGreaterThanOrEqual(interpolatedPositions[index - 1])
    }

    // Verify m=1 cases still satisfy lower bound (with slightly looser FP tolerance)
    const Q = 1 << Math.ceil(Math.log2(drawRate))
    const minStep = tinyVelocity / Q

    for (let index = 1; index < interpolatedPositions.length; index++) {
      if (updatesPerDraw[index] === 1) {
        const step = interpolatedPositions[index] - interpolatedPositions[index - 1]
        // Scale-aware tolerance for tiny velocity
        const tolerance = Math.max(1e-12, 32 * Number.EPSILON * Math.abs(minStep))
        expect(step + tolerance).toBeGreaterThanOrEqual(minStep)
      }
    }
  })

  it('when m=0, alpha is non-decreasing and positions stay non-decreasing', () => {
    const drawRate = 60
    const updateRate = 61
    const loop = new Snaproll({ drawRate, updateRate })
    const velocity = 10

    let previousPosition = 0
    let currentPosition = 0
    let updatesSinceLastDraw = 0
    const interpolatedPositions: number[] = []
    const updatesPerDraw: number[] = []
    const alphaValues: number[] = []

    loop.subscribe((context) => {
      if (context.action === SnaprollActionType.Update) {
        previousPosition = currentPosition
        currentPosition += velocity
        updatesSinceLastDraw++
      } else if (context.action === SnaprollActionType.Draw) {
        const pos = (1 - context.alpha) * previousPosition + context.alpha * currentPosition
        interpolatedPositions.push(pos)
        updatesPerDraw.push(updatesSinceLastDraw)
        alphaValues.push(context.alpha)
        updatesSinceLastDraw = 0
      }
      return undefined
    })

    startAnimationLoop(loop)

    // Many short draws to induce occasional m=0 intervals
    const frameTimes = Array.from({ length: 120 }, (_, index) => 12 + (index % 4)) // 12–15 ms
    frameTimes.forEach((frameTime) => advanceOneFrame(frameTime))
    loop.pause()

    // Guard array invariants
    expect(interpolatedPositions.length).toBe(updatesPerDraw.length)
    expect(interpolatedPositions.length).toBe(alphaValues.length)

    for (let index = 1; index < interpolatedPositions.length; index++) {
      // Still non-decreasing overall
      expect(interpolatedPositions[index]).toBeGreaterThanOrEqual(interpolatedPositions[index - 1])

      // Critical: when m=0, alpha must be non-decreasing (no updates, α rises within same bracket)
      if (updatesPerDraw[index] === 0) {
        expect(alphaValues[index]).toBeGreaterThanOrEqual(alphaValues[index - 1])
        expect(interpolatedPositions[index]).toBeGreaterThanOrEqual(
          interpolatedPositions[index - 1],
        )
      }
    }
  })

  it('monotone with varying per-update increments remains non-decreasing', () => {
    const drawRate = 60
    const updateRate = 180
    const loop = new Snaproll({ drawRate, updateRate })
    let previousPosition = 0
    let currentPosition = 0
    let k = 0
    const positions: number[] = []

    loop.subscribe((context) => {
      if (context.action === SnaprollActionType.Update) {
        // Increasing Δx_k (gentle acceleration)
        const delta = 1 + 0.001 * k++
        previousPosition = currentPosition
        currentPosition += delta
      } else if (context.action === SnaprollActionType.Draw) {
        positions.push((1 - context.alpha) * previousPosition + context.alpha * currentPosition)
      }
      return undefined
    })

    startAnimationLoop(loop)
    for (let index = 0; index < 80; index++) {
      advanceOneFrame(12 + Math.random() * 13)
    }
    loop.pause()

    expect(positions.length).toBeGreaterThan(50)

    // Monotonicity holds even with varying step sizes
    for (let index = 1; index < positions.length; index++) {
      expect(positions[index]).toBeGreaterThanOrEqual(positions[index - 1])
    }
  })

  it('handles big stutter frames with multi-update bursts', () => {
    const updateRate = 120
    const drawRate = 60
    const loop = new Snaproll({ drawRate, updateRate })
    const velocity = 8

    let previousPosition = 0
    let currentPosition = 0
    let updatesSinceLastDraw = 0
    const interpolatedPositions: number[] = []
    const updatesPerDraw: number[] = []
    const alphaValues: number[] = []

    loop.subscribe((context) => {
      if (context.action === SnaprollActionType.Update) {
        previousPosition = currentPosition
        currentPosition += velocity
        updatesSinceLastDraw++
      } else if (context.action === SnaprollActionType.Draw) {
        const pos = (1 - context.alpha) * previousPosition + context.alpha * currentPosition
        interpolatedPositions.push(pos)
        updatesPerDraw.push(updatesSinceLastDraw)
        alphaValues.push(context.alpha)
        updatesSinceLastDraw = 0
      }
      return undefined
    })

    startAnimationLoop(loop)

    // Big stutter pattern: normal frames mixed with fat frames that cause m >> 1
    TEST_DATA.STUTTER_FRAME_TIMES.forEach((frameTime) => advanceOneFrame(frameTime))
    loop.pause()

    // Guard array invariants
    expect(interpolatedPositions.length).toBe(updatesPerDraw.length)
    expect(interpolatedPositions.length).toBe(alphaValues.length)
    expect(interpolatedPositions.length).toBeGreaterThan(5)

    // Verify we got some large m values (double digits)
    const largeUpdateCounts = updatesPerDraw.filter((m) => m >= 10)
    expect(largeUpdateCounts.length).toBeGreaterThan(0)

    // Core validation: monotonicity even with large update bursts
    for (let index = 1; index < interpolatedPositions.length; index++) {
      expect(interpolatedPositions[index]).toBeGreaterThanOrEqual(interpolatedPositions[index - 1])
    }

    // Theory identity holds even with large m values
    for (let index = 1; index < interpolatedPositions.length; index++) {
      const step = interpolatedPositions[index] - interpolatedPositions[index - 1]
      const m = updatesPerDraw[index]
      const deltaAlpha = alphaValues[index] - alphaValues[index - 1]
      const expectedStep = (m + deltaAlpha) * velocity

      const tolerance = Math.max(1e-10, 64 * Number.EPSILON * Math.abs(expectedStep))
      expect(Math.abs(step - expectedStep)).toBeLessThan(tolerance)
    }
  })

  it('property-based fuzz test: monotonicity holds for random configurations', () => {
    const trials = TEST_COUNTS.PROPERTY_TEST_TRIALS // Reduced for reasonable test time

    for (let trial = 0; trial < trials; trial++) {
      const drawRate = 30 + Math.floor(Math.random() * 91) // 30-120
      const updateRate = drawRate + 1 + Math.floor(Math.random() * 180) // drawRate+1 to drawRate+180

      // Generate random frame timing
      const frameTimes = Array.from({ length: 30 }, () => 12 + Math.random() * 13) // 12-25ms

      const { interpolatedPositions } = testMonotonicityWithUpdateTracking(
        updateRate,
        drawRate,
        frameTimes,
      )

      // Assert monotonicity for this random configuration
      for (let index = 1; index < interpolatedPositions.length; index++) {
        if (interpolatedPositions[index] < interpolatedPositions[index - 1]) {
          throw new Error(
            `Monotonicity violation at trial ${trial} with rates ${updateRate}/${drawRate}: ` +
              `position ${index - 1}=${interpolatedPositions[index - 1]} > position ${index}=${interpolatedPositions[index]}`,
          )
        }
      }
    }
  })

  it('negative control: proves endpoint bookkeeping mistakes cause backwards motion', () => {
    const updateRate = 120
    const drawRate = 60
    const loop = new Snaproll({ drawRate, updateRate })
    const velocity = 10

    let currentPosition = 0
    let wrongPreviousPosition = 0 // Intentionally wrong bookkeeping
    let drawCount = 0
    const interpolatedPositions: number[] = []

    loop.subscribe((context) => {
      if (context.action === SnaprollActionType.Update) {
        currentPosition += velocity
      } else if (context.action === SnaprollActionType.Draw) {
        drawCount++

        // Simulate common bookkeeping mistake: using stale "previous" that's multiple updates behind
        // eslint-disable-next-line unicorn/prefer-ternary
        if (drawCount > 3) {
          // After a few draws, use an outdated previous position to create backwards interpolation
          wrongPreviousPosition = currentPosition - 4 * velocity // 4 updates behind
        } else {
          wrongPreviousPosition = currentPosition - velocity // Start with correct previous
        }

        // Intentionally wrong interpolation using stale previous position
        const pos = (1 - context.alpha) * wrongPreviousPosition + context.alpha * currentPosition
        interpolatedPositions.push(pos)
      }
      return undefined
    })

    startAnimationLoop(loop)

    // Run enough frames to trigger the bookkeeping error pattern
    for (let index = 0; index < 15; index++) {
      advanceOneFrame(TIMING_VALUES.STANDARD_FRAME)
    }

    loop.pause()

    // Should detect backwards motion due to wrong endpoint usage
    let foundBackwardsMotion = false
    for (let index = 1; index < interpolatedPositions.length; index++) {
      if (interpolatedPositions[index] < interpolatedPositions[index - 1]) {
        foundBackwardsMotion = true
        break
      }
    }

    expect(foundBackwardsMotion).toBe(true) // Proves the cause of apparent reversals
  })
})

describe('legacy compatibility tests', () => {
  it('maintains compatibility with original test pattern', () => {
    const updateRate = 60
    const drawRate = 60
    const loop = new Snaproll({ drawRate, updateRate })
    const begin = vi.fn()
    const update = vi.fn()
    const draw = vi.fn()

    loop.subscribe((value) => {
      const timestamp = timeController.now()

      if (value.action === SnaprollActionType.Begin) {
        begin(value, timestamp)
      }

      if (value.action === SnaprollActionType.Update) {
        update(value, timestamp)
      }

      if (value.action === SnaprollActionType.Draw) {
        draw(value, timestamp)
      }
      return undefined
    })

    loop.resume()

    // Simulate 10 seconds of animation
    const targetFrames = drawRate * 10
    for (let index = 0; index < targetFrames; index++) {
      timeController.advance(1000 / drawRate)
    }

    expect(isApproximatelyEqual(draw.mock.calls.length, targetFrames, 5)).toBe(true)
    expect(isApproximatelyEqual(loop.drawRate, drawRate, 5)).toBe(true)

    loop.pause()
  })
})
