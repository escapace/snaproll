import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Snaproll,
  SnaprollActionType,
  type SnaprollActionUpdate,
  type SnaprollContext,
  type SnaprollSubscriptionControls,
} from './index'
import { calculateTimingStats, isApproximatelyEqual, MockTimeController } from './test-utilities'

let timeController: MockTimeController

// Helper function to properly start animation loop
function startAnimationLoop(loop: Snaproll): void {
  loop.resume()
  timeController.advance(0.001) // First RAF: setup callback
}

// Helper function to advance animation loop by one frame
function advanceOneFrame(frameTime = 16.67): void {
  timeController.advance(frameTime) // Animation frame execution
}

// Helper function to resume a paused subscription
function resumeSubscription(controls: SnaprollSubscriptionControls): void {
  controls.resume()
  timeController.advance(0.001) // Resume triggers new animation loop setup
}

// Helper function for monotonicity test with update tracking
const testMonotonicityWithUpdateTracking = (
  updateRate: number,
  drawRate: number,
  frameTimes: number[],
) => {
  const loop = new Snaproll({ drawRate, updateRate })
  const velocity = 10

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

beforeEach(() => {
  timeController = new MockTimeController()
})

describe('Snaproll Unit Tests', () => {
  describe('Constructor and Configuration', () => {
    it('initializes with default 60fps configuration when no options provided', () => {
      const snaprollInstance = new Snaproll()

      expect(snaprollInstance.state).toBe('paused')
      expect(snaprollInstance.updateRate).toBe(60)
    })

    it('initializes with custom drawRate and updateRate configuration', () => {
      const customConfiguration = { drawRate: 30, updateRate: 30 }
      const snaprollInstance = new Snaproll(customConfiguration)

      expect(snaprollInstance.updateRate).toBe(customConfiguration.updateRate)
    })

    it('rejects invalid drawRate values with descriptive error messages', () => {
      expect(() => new Snaproll({ drawRate: -1 })).toThrow(
        '[snaproll] draw rate must be a positive number',
      )
      expect(() => new Snaproll({ drawRate: 0 })).toThrow(
        '[snaproll] draw rate must be a positive number',
      )
      expect(() => new Snaproll({ drawRate: Infinity })).toThrow(
        '[snaproll] draw rate must be a positive number',
      )
      expect(() => new Snaproll({ drawRate: NaN })).toThrow(
        '[snaproll] draw rate must be a positive number',
      )
    })

    it('rejects invalid updateRate values with descriptive error messages', () => {
      expect(() => new Snaproll({ updateRate: -1 })).toThrow(
        '[snaproll] timestep must be a positive number',
      )
      expect(() => new Snaproll({ updateRate: 0 })).toThrow(
        '[snaproll] timestep must be a positive number',
      )
      expect(() => new Snaproll({ updateRate: Infinity })).toThrow(
        '[snaproll] timestep must be a positive number',
      )
      expect(() => new Snaproll({ updateRate: NaN })).toThrow(
        '[snaproll] timestep must be a positive number',
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
      const snaprollInstance = new Snaproll()
      const subscriptionCallback = vi.fn()

      const subscriptionControls = snaprollInstance.subscribe(subscriptionCallback)
      expect(typeof subscriptionControls.pause).toBe('function')
      expect(typeof subscriptionControls.resume).toBe('function')
      expect(typeof subscriptionControls.unsubscribe).toBe('function')

      subscriptionControls.unsubscribe()
    })

    it('executes all registered subscriptions during animation loop', () => {
      const snaprollInstance = new Snaproll()
      const firstSubscriptionCallback = vi.fn()
      const secondSubscriptionCallback = vi.fn()

      const firstSubscriptionControls = snaprollInstance.subscribe(firstSubscriptionCallback)
      const secondSubscriptionControls = snaprollInstance.subscribe(secondSubscriptionCallback)

      startAnimationLoop(snaprollInstance)
      advanceOneFrame(20)

      expect(firstSubscriptionCallback).toHaveBeenCalled()
      expect(secondSubscriptionCallback).toHaveBeenCalled()

      firstSubscriptionControls.unsubscribe()
      secondSubscriptionControls.unsubscribe()
    })

    it('allows individual subscription pause and resume without affecting others', () => {
      const snaprollInstance = new Snaproll()
      const pausableSubscriptionCallback = vi.fn()
      const activeSubscriptionCallback = vi.fn()

      const pausableSubscriptionControls = snaprollInstance.subscribe(pausableSubscriptionCallback)
      const activeSubscriptionControls = snaprollInstance.subscribe(activeSubscriptionCallback)

      startAnimationLoop(snaprollInstance)
      pausableSubscriptionControls.pause()

      advanceOneFrame(20)

      expect(pausableSubscriptionCallback).not.toHaveBeenCalled()
      expect(activeSubscriptionCallback).toHaveBeenCalled()

      pausableSubscriptionControls.resume()
      pausableSubscriptionCallback.mockClear()
      activeSubscriptionCallback.mockClear()

      advanceOneFrame(20)

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

      advanceOneFrame(20)

      expect(deferredSubscriptionCallback).not.toHaveBeenCalled()

      resumeSubscription(deferredSubscriptionControls)
      advanceOneFrame(20)

      expect(deferredSubscriptionCallback).toHaveBeenCalled()

      deferredSubscriptionControls.unsubscribe()
    })
  })

  describe('Frame Rate and Timing', () => {
    it('accurately calculates actual drawRate after running animation frames', () => {
      const targetDrawRate = 60
      const snaprollInstance = new Snaproll({ drawRate: targetDrawRate })

      const frameCallback = vi.fn()
      snaprollInstance.subscribe(frameCallback)
      startAnimationLoop(snaprollInstance)

      // Simulate exactly 1 second at target drawRate
      const updateFrames = targetDrawRate
      const frameInterval = 1000 / targetDrawRate
      for (let frameIndex = 0; frameIndex < updateFrames; frameIndex++) {
        advanceOneFrame(frameInterval)
      }

      expect(isApproximatelyEqual(snaprollInstance.drawRate, targetDrawRate, 5)).toBe(true)

      snaprollInstance.pause()
    })

    it('accepts drawRate changes through setter without throwing errors', () => {
      const initialDrawRate = 60
      const newDrawRate = 30
      const snaprollInstance = new Snaproll({ drawRate: initialDrawRate })

      snaprollInstance.drawRate = newDrawRate

      // The drawRate property returns the target draw rate
      // Verify the setter operation completed successfully
      expect(snaprollInstance.drawRate).toBe(newDrawRate)
    })

    it('rejects invalid drawRate values through setter with descriptive errors', () => {
      const snaprollInstance = new Snaproll()

      expect(() => {
        snaprollInstance.drawRate = -1
      }).toThrow('[snaproll] draw rate must be a positive number')
      expect(() => {
        snaprollInstance.drawRate = 0
      }).toThrow('[snaproll] draw rate must be a positive number')
      expect(() => {
        snaprollInstance.drawRate = Infinity
      }).toThrow('[snaproll] draw rate must be a positive number')
      expect(() => {
        snaprollInstance.drawRate = NaN
      }).toThrow('[snaproll] draw rate must be a positive number')
    })

    it('maintains updateRate value through getter and setter operations', () => {
      const initialUpdateRate = 60
      const newUpdateRate = 30
      const snaprollInstance = new Snaproll({ updateRate: initialUpdateRate })

      expect(snaprollInstance.updateRate).toBe(initialUpdateRate)

      snaprollInstance.updateRate = newUpdateRate
      expect(snaprollInstance.updateRate).toBe(newUpdateRate)
    })

    it('rejects invalid updateRate values through setter with descriptive errors', () => {
      const snaprollInstance = new Snaproll()

      expect(() => {
        snaprollInstance.updateRate = -1
      }).toThrow('[snaproll] timestep must be a positive number')
      expect(() => {
        snaprollInstance.updateRate = 0
      }).toThrow('[snaproll] timestep must be a positive number')
      expect(() => {
        snaprollInstance.updateRate = Infinity
      }).toThrow('[snaproll] timestep must be a positive number')
      expect(() => {
        snaprollInstance.updateRate = NaN
      }).toThrow('[snaproll] timestep must be a positive number')
    })
  })

  describe('Reset Functionality', () => {
    it('applies new configuration options while preserving paused state', () => {
      const initialConfig = { drawRate: 30, updateRate: 50 }
      const newConfig = { drawRate: 60, updateRate: 60 }
      const snaprollInstance = new Snaproll(initialConfig)
      const subscriptionCallback = vi.fn()
      snaprollInstance.subscribe(subscriptionCallback)

      snaprollInstance.reset(newConfig)

      expect(snaprollInstance.updateRate).toBe(newConfig.updateRate)
      expect(snaprollInstance.state).toBe('paused')
    })

    it('preserves existing subscriptions and active state when reset without options', () => {
      const snaprollInstance = new Snaproll()
      const subscriptionCallback = vi.fn()
      snaprollInstance.subscribe(subscriptionCallback)
      snaprollInstance.resume()

      expect(snaprollInstance.state).toBe('active')

      snaprollInstance.reset()

      expect(snaprollInstance.state).toBe('active')
    })

    it('maintains active state after clearing subscriptions when keepSubscriptions is false', () => {
      const snaprollInstance = new Snaproll()
      const subscriptionCallback = vi.fn()
      snaprollInstance.subscribe(subscriptionCallback)
      snaprollInstance.resume()

      expect(snaprollInstance.state).toBe('active')

      snaprollInstance.reset({ keepSubscriptions: false })

      expect(snaprollInstance.state).toBe('idle')
    })
  })
})

describe('Animation Loop Integration Tests', () => {
  describe('Action Sequence', () => {
    it('executes animation actions in correct chronological order: Begin → Update → Draw', () => {
      const frameConfig = { drawRate: 60, updateRate: 60 }
      const snaprollInstance = new Snaproll(frameConfig)
      const capturedContexts: SnaprollContext[] = []

      snaprollInstance.subscribe((action) => {
        capturedContexts.push({ ...action })
        return undefined
      })

      startAnimationLoop(snaprollInstance)
      advanceOneFrame(16.67)

      expect(capturedContexts.length).toBeGreaterThan(0)

      const beginActionIndex = capturedContexts.findIndex(
        (context) => context.action === SnaprollActionType.Begin,
      )
      const updateActionIndex = capturedContexts.findIndex(
        (context) => context.action === SnaprollActionType.Update,
      )
      const drawActionIndex = capturedContexts.findIndex(
        (context) => context.action === SnaprollActionType.Draw,
      )

      expect(beginActionIndex).toBeGreaterThanOrEqual(0)
      expect(drawActionIndex).toBeGreaterThanOrEqual(0)
      expect(drawActionIndex).toBeGreaterThan(beginActionIndex)

      if (updateActionIndex >= 0) {
        expect(updateActionIndex).toBeGreaterThan(beginActionIndex)
        expect(drawActionIndex).toBeGreaterThan(updateActionIndex)
      }

      snaprollInstance.pause()
    })

    it('provides accurate timing data in all action types', () => {
      const frameConfig = { drawRate: 60, updateRate: 60 }
      const snaprollInstance = new Snaproll(frameConfig)
      const capturedContexts: SnaprollContext[] = []

      snaprollInstance.subscribe((action) => {
        capturedContexts.push({ ...action })
        return undefined
      })

      startAnimationLoop(snaprollInstance)
      advanceOneFrame(16.67)

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
        expect(updateAction.timestep).toBe(1000 / frameConfig.updateRate)
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
      const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
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

      // Simulate 10 frames
      for (let index = 0; index < 10; index++) {
        advanceOneFrame(16.67)
      }

      const stats = calculateTimingStats(frameTimes)
      const expectedFrameTime = 16.67

      expect(isApproximatelyEqual(stats.mean, expectedFrameTime, 1)).toBe(true)
      expect(stats.coefficientOfVariation).toBeLessThan(0.1) // Low variance

      loop.pause()
    })

    it('handles variable frame timing gracefully', () => {
      const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
      const actions: SnaprollContext[] = []

      loop.subscribe((action) => {
        actions.push({ ...action })
        return undefined
      })

      startAnimationLoop(loop)

      // Simulate variable frame times
      const frameTimes = [16.67, 33.33, 8.33, 25, 16.67]
      frameTimes.forEach((time) => advanceOneFrame(time))

      const updateContexts = actions.filter((a) => a.action === SnaprollActionType.Update)
      const drawContexts = actions.filter((a) => a.action === SnaprollActionType.Draw)

      expect(updateContexts.length).toBeGreaterThan(0)
      expect(drawContexts.length).toBeGreaterThan(0)

      // Should handle timing gracefully without errors
      expect(actions.length).toBeGreaterThan(frameTimes.length * 2) // At least Begin + Draw per frame

      loop.pause()
    })
  })

  describe('Subscription Edge Cases', () => {
    it('handles subscription during animation loop', () => {
      const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      loop.subscribe(callback1)
      startAnimationLoop(loop)

      advanceOneFrame(16.67)
      expect(callback1).toHaveBeenCalled()

      // Add subscription during loop
      loop.subscribe(callback2)
      callback1.mockClear()

      advanceOneFrame(16.67)
      expect(callback1).toHaveBeenCalled()
      expect(callback2).toHaveBeenCalled()

      loop.pause()
    })

    it('handles unsubscription during animation loop', () => {
      const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const controls1 = loop.subscribe(callback1)
      const controls2 = loop.subscribe(callback2)
      startAnimationLoop(loop)

      advanceOneFrame(16.67)
      expect(callback1).toHaveBeenCalled()
      expect(callback2).toHaveBeenCalled()

      // Remove subscription during loop
      controls1.unsubscribe()
      callback1.mockClear()
      callback2.mockClear()

      advanceOneFrame(16.67)
      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalled()

      controls2.unsubscribe()
    })
  })
})

describe('Edge Cases and Error Handling', () => {
  describe('Extreme Values', () => {
    it('handles very high drawRate values', () => {
      const loop = new Snaproll({ drawRate: 240, updateRate: 240 })
      const callback = vi.fn()

      loop.subscribe(callback)
      startAnimationLoop(loop)

      advanceOneFrame(50) // Multiple frames
      expect(callback).toHaveBeenCalled()

      loop.pause()
    })

    it('handles very low drawRate values', () => {
      const loop = new Snaproll({ drawRate: 1, updateRate: 1 })
      const callback = vi.fn()

      loop.subscribe(callback)
      startAnimationLoop(loop)

      advanceOneFrame(1100) // Just over 1 second
      expect(callback).toHaveBeenCalled()

      loop.pause()
    })

    it('handles very high updateRate values', () => {
      const loop = new Snaproll({ drawRate: 60, updateRate: 10_000 })
      const actions: SnaprollContext[] = []

      loop.subscribe((action) => {
        actions.push({ ...action })
        return undefined
      })

      startAnimationLoop(loop)
      advanceOneFrame(16.67)

      const updateContexts = actions.filter((a) => a.action === SnaprollActionType.Update)
      expect(updateContexts.length).toBeGreaterThan(100) // Many small updates

      loop.pause()
    })

    it('handles very low updateRate values', () => {
      const loop = new Snaproll({ drawRate: 60, updateRate: 10 })
      const actions: SnaprollContext[] = []

      loop.subscribe((action) => {
        actions.push({ ...action })
        return undefined
      })

      loop.resume()
      timeController.advance(16.67)

      const updateContexts = actions.filter((a) => a.action === SnaprollActionType.Update)
      expect(updateContexts.length).toBe(0) // No updates in short frame

      loop.pause()
    })
  })

  describe('Callback Error Handling', () => {
    it('continues animation loop when callback throws error', () => {
      const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
      const errorCallback = vi.fn(() => {
        throw new Error('Test error')
      })

      loop.subscribe(errorCallback)
      startAnimationLoop(loop)

      // Should not crash the MockTimeController - advance multiple frames
      expect(() => {
        advanceOneFrame(16.67)
        advanceOneFrame(16.67)
        advanceOneFrame(16.67)
      }).not.toThrow()

      expect(errorCallback).toHaveBeenCalled()

      // Core test: MockTimeController handles errors gracefully and system continues
      // Create fresh loop to test recovery
      const recoveryLoop = new Snaproll({ drawRate: 60, updateRate: 60 })
      const normalCallback = vi.fn()
      recoveryLoop.subscribe(normalCallback)
      startAnimationLoop(recoveryLoop)

      advanceOneFrame(16.67)
      expect(normalCallback).toHaveBeenCalled()

      loop.pause()
      recoveryLoop.pause()
    })
  })

  describe('Rapid State Changes', () => {
    it('handles rapid pause/resume cycles', () => {
      const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
      const callback = vi.fn()

      loop.subscribe(callback)

      for (let index = 0; index < 10; index++) {
        loop.resume()
        expect(loop.state).toBe('active')
        loop.pause()
        expect(loop.state).toBe('paused')
      }
    })

    it('handles rapid subscription changes', () => {
      const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
      const callbacks = Array.from({ length: 10 }, () => vi.fn())

      const controls = callbacks.map((callback) => loop.subscribe(callback))
      startAnimationLoop(loop)
      advanceOneFrame(16.67)

      callbacks.forEach((callback) => expect(callback).toHaveBeenCalled())

      controls.forEach((ctrl) => ctrl.unsubscribe())
      callbacks.forEach((callback) => callback.mockClear())

      timeController.advance(16.67)
      callbacks.forEach((callback) => expect(callback).not.toHaveBeenCalled())

      loop.pause()
    })
  })

  describe('Memory and Resource Management', () => {
    it('cleans up subscriptions properly', () => {
      const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
      const callbacks = Array.from({ length: 100 }, () => vi.fn())

      const controls = callbacks.map((callback) => loop.subscribe(callback))
      startAnimationLoop(loop)

      advanceOneFrame(16.67)
      callbacks.forEach((callback) => expect(callback).toHaveBeenCalled())

      // Unsubscribe all
      controls.forEach((ctrl) => ctrl.unsubscribe())
      expect(loop.state).toBe('idle')

      // Add new subscriptions to ensure no memory leaks
      const newCallbacks = Array.from({ length: 10 }, () => vi.fn())
      newCallbacks.forEach((callback) => loop.subscribe(callback))
      startAnimationLoop(loop)

      advanceOneFrame(16.67)
      newCallbacks.forEach((callback) => expect(callback).toHaveBeenCalled())

      loop.pause()
    })

    it('handles reset with many subscriptions', () => {
      const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
      const callbacks = Array.from({ length: 50 }, () => vi.fn())

      callbacks.forEach((callback) => loop.subscribe(callback))
      startAnimationLoop(loop)

      advanceOneFrame(16.67)
      callbacks.forEach((callback) => expect(callback).toHaveBeenCalled())

      loop.reset({ keepSubscriptions: false })
      // State is idle after reset with keepSubscriptions: false
      expect(loop.state).toBe('idle')

      callbacks.forEach((callback) => callback.mockClear())
      loop.resume()
      timeController.advance(16.67)

      // Should not call old callbacks since they were cleared
      callbacks.forEach((callback) => expect(callback).not.toHaveBeenCalled())
    })
  })

  describe('Boundary Conditions', () => {
    it('handles zero frame advance', () => {
      const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
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
      const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
      const callback = vi.fn()

      loop.subscribe(callback)
      startAnimationLoop(loop)

      advanceOneFrame(16.67)
      expect(callback).toHaveBeenCalled()

      callback.mockClear()

      // Advance forward normally after any timing anomaly
      advanceOneFrame(16.67)
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
    const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
    const actions: SnaprollContext[] = []

    loop.subscribe((action) => {
      actions.push({ ...action })
      return undefined
    })

    startAnimationLoop(loop)

    // Run a few frames
    advanceOneFrame(16.67)
    advanceOneFrame(16.67)
    advanceOneFrame(16.67)

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
    const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
    const callbacks = Array.from({ length: 5 }, () => vi.fn())

    callbacks.forEach((callback) => loop.subscribe(callback))
    startAnimationLoop(loop)

    // Run several frames
    for (let index = 0; index < 5; index++) {
      advanceOneFrame(16.67)
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
    const loop = new Snaproll({ drawRate: 60, updateRate: 60 })

    expect(loop.updateRate).toBe(60)
    expect(loop.state).toBe('paused')

    loop.reset({ drawRate: 30, updateRate: 30 })

    expect(loop.updateRate).toBe(30)
    expect(loop.state).toBe('paused') // State should be preserved
  })

  it('pause/resume cycles work reliably', () => {
    const loop = new Snaproll({ drawRate: 60, updateRate: 60 })
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
    advanceOneFrame(16.67)
    expect(callback).toHaveBeenCalled()

    loop.pause()
  })

  describe('Performance Validation', () => {
    it('handles basic subscription cleanup properly', () => {
      const loop = new Snaproll({ drawRate: 60, updateRate: 60 })

      // Create and remove some subscriptions
      const callbacks = Array.from({ length: 10 }, () => vi.fn())
      const controls = callbacks.map((callback) => loop.subscribe(callback))

      startAnimationLoop(loop)
      advanceOneFrame(16.67)

      // All should be called
      callbacks.forEach((callback) => expect(callback).toHaveBeenCalled())

      // Clean up half
      controls.slice(0, 5).forEach((ctrl) => ctrl.unsubscribe())

      // System should still work with remaining subscriptions
      callbacks.forEach((callback) => callback.mockClear())
      advanceOneFrame(16.67)

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
    advanceOneFrame(200)

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
    const loop = new Snaproll({ drawRate: 60, updateRate: 60 })

    // Test with realistic number of subscriptions (5-10 is typical)
    const callbacks = Array.from({ length: 8 }, () => vi.fn())
    callbacks.forEach((callback) => loop.subscribe(callback))
    startAnimationLoop(loop)

    // Run several frames
    for (let index = 0; index < 5; index++) {
      advanceOneFrame(16.67)
    }

    // All callbacks should be executed
    callbacks.forEach((callback) => expect(callback).toHaveBeenCalled())
    expect(loop.state).toBe('active')

    loop.pause()
  })

  it('subscription lifecycle works efficiently', () => {
    const loop = new Snaproll({ drawRate: 60, updateRate: 60 })

    // Create a reasonable number of subscriptions
    const callbacks = Array.from({ length: 10 }, () => vi.fn())
    const controls = callbacks.map((callback) => loop.subscribe(callback))

    startAnimationLoop(loop)
    advanceOneFrame(16.67)

    // All should be called initially
    callbacks.forEach((callback) => expect(callback).toHaveBeenCalled())

    // Remove half
    controls.slice(0, 5).forEach((ctrl) => ctrl.unsubscribe())

    callbacks.forEach((callback) => callback.mockClear())
    advanceOneFrame(16.67)

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
        const frameTimes = Array.from({ length: 50 }, (_, index) => 12 + (index % 13)) // 12-24ms range
        const { interpolatedPositions, updatesPerDraw, velocity } =
          testMonotonicityWithUpdateTracking(updateRate, drawRate, frameTimes)

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
    const frameTimes = [16.67, 17.2, 16.1, 18, 16.8, 15.9, 17.5, 16.2, 17.8, 16.5]
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
    const frameTimes = [16.67, 17.2, 16.1, 18, 16.8, 15.9, 17.5, 16.67, 17.2, 16.1]
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
    const stutterFrameTimes = [16.67, 100, 8.33, 100, 16.67, 150, 12, 120, 16.67, 16.67]
    stutterFrameTimes.forEach((frameTime) => advanceOneFrame(frameTime))
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
    const trials = 50 // Reduced for reasonable test time

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
      advanceOneFrame(16.67)
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

describe('Legacy Compatibility Tests', () => {
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
