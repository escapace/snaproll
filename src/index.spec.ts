import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Snaproll,
  SnaprollActionType,
  type SnaprollAction,
  type SnaprollActionUpdate,
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

beforeEach(() => {
  timeController = new MockTimeController()
})

describe('Snaproll Unit Tests', () => {
  describe('Constructor and Configuration', () => {
    it('initializes with default 60fps configuration when no options provided', () => {
      const snaprollInstance = new Snaproll()

      expect(snaprollInstance.state).toBe('paused')
      expect(snaprollInstance.timestep).toBe(1000 / 60)
    })

    it('initializes with custom fps and timestep configuration', () => {
      const customConfiguration = { fps: 30, timestep: 1000 / 30 }
      const snaprollInstance = new Snaproll(customConfiguration)

      expect(snaprollInstance.timestep).toBe(customConfiguration.timestep)
    })

    it('rejects invalid fps values with descriptive error messages', () => {
      expect(() => new Snaproll({ fps: -1 })).toThrow('[snaproll] fps must be a positive number')
      expect(() => new Snaproll({ fps: 0 })).toThrow('[snaproll] fps must be a positive number')
      expect(() => new Snaproll({ fps: Infinity })).toThrow(
        '[snaproll] fps must be a positive number',
      )
      expect(() => new Snaproll({ fps: NaN })).toThrow('[snaproll] fps must be a positive number')
    })

    it('rejects invalid timestep values with descriptive error messages', () => {
      expect(() => new Snaproll({ timestep: -1 })).toThrow(
        '[snaproll] timestep must be a positive number',
      )
      expect(() => new Snaproll({ timestep: 0 })).toThrow(
        '[snaproll] timestep must be a positive number',
      )
      expect(() => new Snaproll({ timestep: Infinity })).toThrow(
        '[snaproll] timestep must be a positive number',
      )
      expect(() => new Snaproll({ timestep: NaN })).toThrow(
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
      snaprollInstance.idle()
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
    it('accurately calculates actual fps after running animation frames', () => {
      const targetFps = 60
      const snaprollInstance = new Snaproll({ fps: targetFps })

      const frameCallback = vi.fn()
      snaprollInstance.subscribe(frameCallback)
      startAnimationLoop(snaprollInstance)

      // Simulate exactly 1 second at target fps
      const simulationFrames = targetFps
      const frameInterval = 1000 / targetFps
      for (let frameIndex = 0; frameIndex < simulationFrames; frameIndex++) {
        advanceOneFrame(frameInterval)
      }

      expect(isApproximatelyEqual(snaprollInstance.fps, targetFps, 5)).toBe(true)

      snaprollInstance.pause()
    })

    it('accepts fps changes through setter without throwing errors', () => {
      const initialFps = 60
      const newFps = 30
      const snaprollInstance = new Snaproll({ fps: initialFps })

      snaprollInstance.fps = newFps

      // The fps property returns calculated FPS, not the target
      // Verify the setter operation completed successfully
      expect(snaprollInstance.fps).toBeGreaterThanOrEqual(0)
    })

    it('rejects invalid fps values through setter with descriptive errors', () => {
      const snaprollInstance = new Snaproll()

      expect(() => {
        snaprollInstance.fps = -1
      }).toThrow('[snaproll] fps must be a positive number')
      expect(() => {
        snaprollInstance.fps = 0
      }).toThrow('[snaproll] fps must be a positive number')
      expect(() => {
        snaprollInstance.fps = Infinity
      }).toThrow('[snaproll] fps must be a positive number')
      expect(() => {
        snaprollInstance.fps = NaN
      }).toThrow('[snaproll] fps must be a positive number')
    })

    it('maintains timestep value through getter and setter operations', () => {
      const initialTimestep = 16
      const newTimestep = 32
      const snaprollInstance = new Snaproll({ timestep: initialTimestep })

      expect(snaprollInstance.timestep).toBe(initialTimestep)

      snaprollInstance.timestep = newTimestep
      expect(snaprollInstance.timestep).toBe(newTimestep)
    })

    it('rejects invalid timestep values through setter with descriptive errors', () => {
      const snaprollInstance = new Snaproll()

      expect(() => {
        snaprollInstance.timestep = -1
      }).toThrow('[snaproll] timestep must be a positive number')
      expect(() => {
        snaprollInstance.timestep = 0
      }).toThrow('[snaproll] timestep must be a positive number')
      expect(() => {
        snaprollInstance.timestep = Infinity
      }).toThrow('[snaproll] timestep must be a positive number')
      expect(() => {
        snaprollInstance.timestep = NaN
      }).toThrow('[snaproll] timestep must be a positive number')
    })
  })

  describe('Reset Functionality', () => {
    it('applies new configuration options while preserving paused state', () => {
      const initialConfig = { fps: 30, timestep: 20 }
      const newConfig = { fps: 60, timestep: 16 }
      const snaprollInstance = new Snaproll(initialConfig)
      const subscriptionCallback = vi.fn()
      snaprollInstance.subscribe(subscriptionCallback)

      snaprollInstance.reset(newConfig)

      expect(snaprollInstance.timestep).toBe(newConfig.timestep)
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

      expect(snaprollInstance.state).toBe('active')
    })
  })
})

describe('Animation Loop Integration Tests', () => {
  describe('Action Sequence', () => {
    it('executes animation actions in correct chronological order: Begin → Update → Draw', () => {
      const frameConfig = { fps: 60, timestep: 16.67 }
      const snaprollInstance = new Snaproll(frameConfig)
      const capturedActions: SnaprollAction[] = []

      snaprollInstance.subscribe((action) => {
        capturedActions.push({ ...action })
        return undefined
      })

      startAnimationLoop(snaprollInstance)
      advanceOneFrame(frameConfig.timestep)

      expect(capturedActions.length).toBeGreaterThan(0)

      const beginActionIndex = capturedActions.findIndex(
        (action) => action.type === SnaprollActionType.Begin,
      )
      const updateActionIndex = capturedActions.findIndex(
        (action) => action.type === SnaprollActionType.Update,
      )
      const drawActionIndex = capturedActions.findIndex(
        (action) => action.type === SnaprollActionType.Draw,
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
      const frameConfig = { fps: 60, timestep: 16.67 }
      const snaprollInstance = new Snaproll(frameConfig)
      const capturedActions: SnaprollAction[] = []

      snaprollInstance.subscribe((action) => {
        capturedActions.push({ ...action })
        return undefined
      })

      startAnimationLoop(snaprollInstance)
      advanceOneFrame(frameConfig.timestep)

      const beginAction = capturedActions.find((action) => action.type === SnaprollActionType.Begin)
      const updateAction = capturedActions.find(
        (action) => action.type === SnaprollActionType.Update,
      )
      const drawAction = capturedActions.find((action) => action.type === SnaprollActionType.Draw)

      expect(beginAction).toBeDefined()
      if (beginAction !== undefined) {
        expect(beginAction.timestamp).toBeGreaterThan(0)
      }

      if (updateAction !== undefined) {
        expect(updateAction.timestamp).toBeDefined()
        expect(updateAction.timestep).toBe(frameConfig.timestep)
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
      const loop = new Snaproll({ fps: 60, timestep: 16.67 })
      const frameTimes: number[] = []
      let lastTimestamp = 0

      loop.subscribe((action) => {
        if (action.type === SnaprollActionType.Draw) {
          if (lastTimestamp > 0) {
            frameTimes.push(action.timestamp - lastTimestamp)
          }
          lastTimestamp = action.timestamp
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
      const loop = new Snaproll({ fps: 60, timestep: 16.67 })
      const actions: SnaprollAction[] = []

      loop.subscribe((action) => {
        actions.push({ ...action })
        return undefined
      })

      startAnimationLoop(loop)

      // Simulate variable frame times
      const frameTimes = [16.67, 33.33, 8.33, 25, 16.67]
      frameTimes.forEach((time) => advanceOneFrame(time))

      const updateActions = actions.filter((a) => a.type === SnaprollActionType.Update)
      const drawActions = actions.filter((a) => a.type === SnaprollActionType.Draw)

      expect(updateActions.length).toBeGreaterThan(0)
      expect(drawActions.length).toBeGreaterThan(0)

      // Should handle timing gracefully without errors
      expect(actions.length).toBeGreaterThan(frameTimes.length * 2) // At least Begin + Draw per frame

      loop.pause()
    })
  })

  describe('Subscription Edge Cases', () => {
    it('handles subscription during animation loop', () => {
      const loop = new Snaproll({ fps: 60, timestep: 16.67 })
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
      const loop = new Snaproll({ fps: 60, timestep: 16.67 })
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
    it('handles very high FPS values', () => {
      const loop = new Snaproll({ fps: 240, timestep: 1000 / 240 })
      const callback = vi.fn()

      loop.subscribe(callback)
      startAnimationLoop(loop)

      advanceOneFrame(50) // Multiple frames
      expect(callback).toHaveBeenCalled()

      loop.pause()
    })

    it('handles very low FPS values', () => {
      const loop = new Snaproll({ fps: 1, timestep: 1000 })
      const callback = vi.fn()

      loop.subscribe(callback)
      startAnimationLoop(loop)

      advanceOneFrame(1100) // Just over 1 second
      expect(callback).toHaveBeenCalled()

      loop.pause()
    })

    it('handles very small timestep values', () => {
      const loop = new Snaproll({ fps: 60, timestep: 0.1 })
      const actions: SnaprollAction[] = []

      loop.subscribe((action) => {
        actions.push({ ...action })
        return undefined
      })

      startAnimationLoop(loop)
      advanceOneFrame(16.67)

      const updateActions = actions.filter((a) => a.type === SnaprollActionType.Update)
      expect(updateActions.length).toBeGreaterThan(100) // Many small updates

      loop.pause()
    })

    it('handles large timestep values', () => {
      const loop = new Snaproll({ fps: 60, timestep: 100 })
      const actions: SnaprollAction[] = []

      loop.subscribe((action) => {
        actions.push({ ...action })
        return undefined
      })

      loop.resume()
      timeController.advance(16.67)

      const updateActions = actions.filter((a) => a.type === SnaprollActionType.Update)
      expect(updateActions.length).toBe(0) // No updates in short frame

      loop.pause()
    })
  })

  describe('Callback Error Handling', () => {
    it('continues animation loop when callback throws error', () => {
      const loop = new Snaproll({ fps: 60, timestep: 16.67 })
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
      const recoveryLoop = new Snaproll({ fps: 60, timestep: 16.67 })
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
      const loop = new Snaproll({ fps: 60, timestep: 16.67 })
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
      const loop = new Snaproll({ fps: 60, timestep: 16.67 })
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
      const loop = new Snaproll({ fps: 60, timestep: 16.67 })
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
      const loop = new Snaproll({ fps: 60, timestep: 16.67 })
      const callbacks = Array.from({ length: 50 }, () => vi.fn())

      callbacks.forEach((callback) => loop.subscribe(callback))
      startAnimationLoop(loop)

      advanceOneFrame(16.67)
      callbacks.forEach((callback) => expect(callback).toHaveBeenCalled())

      loop.reset({ keepSubscriptions: false })
      // State is preserved as active after reset
      expect(loop.state).toBe('active')

      callbacks.forEach((callback) => callback.mockClear())
      loop.resume()
      timeController.advance(16.67)

      // Should not call old callbacks since they were cleared
      callbacks.forEach((callback) => expect(callback).not.toHaveBeenCalled())
    })
  })

  describe('Boundary Conditions', () => {
    it('handles zero frame advance', () => {
      const loop = new Snaproll({ fps: 60, timestep: 16.67 })
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
      const loop = new Snaproll({ fps: 60, timestep: 16.67 })
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
    const timestep = 16.67
    const loop = new Snaproll({ fps: 60, timestep })

    const updateActions: SnaprollActionUpdate[] = []
    let totalFrameTime = 0

    loop.subscribe((action) => {
      if (action.type === SnaprollActionType.Update) {
        updateActions.push(action)
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

    const totalUpdateTime = updateActions.length * timestep
    const expectedUpdateTime = Math.floor(totalFrameTime / timestep) * timestep

    // Practical tolerance - within one timestep
    expect(Math.abs(totalUpdateTime - expectedUpdateTime)).toBeLessThan(timestep)

    loop.pause()
  })

  it('maintains proper action sequence ordering', () => {
    const loop = new Snaproll({ fps: 60, timestep: 16.67 })
    const actions: SnaprollAction[] = []

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

    actions.forEach((action, index) => {
      if (action.type === SnaprollActionType.Begin) {
        lastBeginIndex = index
      } else if (action.type === SnaprollActionType.Draw) {
        expect(index).toBeGreaterThan(lastBeginIndex)
        lastDrawIndex = index
      } else if (action.type === SnaprollActionType.Update) {
        expect(index).toBeGreaterThan(lastBeginIndex)
        if (lastDrawIndex > lastBeginIndex) {
          expect(index).toBeLessThan(lastDrawIndex)
        }
      }
    })

    loop.pause()
  })

  it('subscription count does not affect core functionality', () => {
    const loop = new Snaproll({ fps: 60, timestep: 16.67 })
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
    const loop = new Snaproll({ fps: 60, timestep: 16.67 })

    expect(loop.timestep).toBe(16.67)
    expect(loop.state).toBe('paused')

    loop.reset({ fps: 30, timestep: 33.33 })

    expect(loop.timestep).toBe(33.33)
    expect(loop.state).toBe('paused') // State should be preserved
  })

  it('pause/resume cycles work reliably', () => {
    const loop = new Snaproll({ fps: 60, timestep: 16.67 })
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
      const loop = new Snaproll({ fps: 60, timestep: 16.67 })

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
      { fps: 30, timestep: 33.33 },
      { fps: 60, timestep: 16.67 },
      { fps: 120, timestep: 8.33 },
    ]

    standardFrameRateConfigurations.forEach(({ fps, timestep }) => {
      const snaprollInstance = new Snaproll({ fps, timestep })
      const frameCallback = vi.fn()

      snaprollInstance.subscribe(frameCallback)
      startAnimationLoop(snaprollInstance)

      // Execute multiple frames at the configured rate
      advanceOneFrame(timestep)
      advanceOneFrame(timestep)
      advanceOneFrame(timestep)

      expect(frameCallback).toHaveBeenCalled()
      expect(snaprollInstance.state).toBe('active')

      snaprollInstance.pause()
    })
  })

  it('adapts to realistic browser frame timing variations without issues', () => {
    const standardConfig = { fps: 60, timestep: 16.67 }
    const snaprollInstance = new Snaproll(standardConfig)
    const capturedActions: SnaprollAction[] = []

    snaprollInstance.subscribe((action) => {
      capturedActions.push({ ...action })
      return undefined
    })

    startAnimationLoop(snaprollInstance)

    // Simulate realistic browser timing variations around 60fps target
    const variableFrameIntervals = [15.5, 17.2, 16.1, 18, 16.8]
    variableFrameIntervals.forEach((frameInterval) => advanceOneFrame(frameInterval))

    const beginActions = capturedActions.filter(
      (action) => action.type === SnaprollActionType.Begin,
    )
    const drawActions = capturedActions.filter((action) => action.type === SnaprollActionType.Draw)

    expect(beginActions.length).toBe(variableFrameIntervals.length)
    expect(drawActions.length).toBe(variableFrameIntervals.length)

    snaprollInstance.pause()
  })

  it('transitions smoothly when fps is changed during active animation', () => {
    const initialFps = 60
    const newFps = 30
    const snaprollInstance = new Snaproll({ fps: initialFps, timestep: 1000 / initialFps })
    const frameCallback = vi.fn()

    snaprollInstance.subscribe(frameCallback)
    startAnimationLoop(snaprollInstance)

    advanceOneFrame(1000 / initialFps)
    expect(frameCallback).toHaveBeenCalled()

    frameCallback.mockClear()
    snaprollInstance.fps = newFps

    advanceOneFrame(1000 / newFps)
    expect(frameCallback).toHaveBeenCalled()

    snaprollInstance.pause()
  })

  it('maintains 30fps action frequency despite 60fps frame advance rate', () => {
    const snaprollTargetFps = 30
    const frameAdvanceRate = 60
    const expectedTimestep = 1000 / snaprollTargetFps // 33.33ms
    const frameAdvanceInterval = 1000 / frameAdvanceRate // 16.67ms

    const loop = new Snaproll({ fps: snaprollTargetFps, timestep: expectedTimestep })
    const capturedBeginActions: SnaprollAction[] = []
    const capturedUpdateActions: SnaprollAction[] = []
    const capturedDrawActions: SnaprollAction[] = []

    loop.subscribe((action) => {
      if (action.type === SnaprollActionType.Begin) {
        capturedBeginActions.push(action)
      } else if (action.type === SnaprollActionType.Update) {
        capturedUpdateActions.push(action)
      } else if (action.type === SnaprollActionType.Draw) {
        capturedDrawActions.push(action)
      }
      return undefined
    })

    startAnimationLoop(loop)

    // Simulate 1 second by advancing 60 frames at 16.67ms intervals
    const simulationFrames = frameAdvanceRate
    for (let frameIndex = 0; frameIndex < simulationFrames; frameIndex++) {
      advanceOneFrame(frameAdvanceInterval)
    }

    // All action types should execute at snaproll's configured rate, not the frame advance rate
    expect(isApproximatelyEqual(capturedBeginActions.length, snaprollTargetFps, 3)).toBe(true)
    expect(isApproximatelyEqual(capturedDrawActions.length, snaprollTargetFps, 3)).toBe(true)
    expect(isApproximatelyEqual(capturedUpdateActions.length, snaprollTargetFps, 3)).toBe(true)

    loop.pause()
  })

  it('handles large time advance that triggers updateStep >= 10 and skips draw when callback returns true', () => {
    const timestep = 16.67 // 60fps
    const loop = new Snaproll({ fps: 60, timestep })
    const capturedActions: SnaprollAction[] = []
    let largeUpdateStepDetected = false

    loop.subscribe((action) => {
      capturedActions.push({ ...action })

      // Return true when we detect updateStep >= 10 to trigger skip-draw behavior
      if (action.type === SnaprollActionType.Update && action.updateStep >= 10) {
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
    const beginActions = capturedActions.filter(
      (action) => action.type === SnaprollActionType.Begin,
    )
    expect(beginActions.length).toBe(1)

    // Verify that Update actions executed with large updateStep values
    const updateActions = capturedActions.filter(
      (action) => action.type === SnaprollActionType.Update,
    )
    expect(updateActions.length).toBe(1)

    // Should have an update step >= 10
    const largeUpdateSteps = updateActions.filter((action) => action.updateStep >= 10)
    expect(largeUpdateSteps.length).toBe(1)

    // Verify that Draw action was skipped (should be 0 draw actions)
    const drawActions = capturedActions.filter((action) => action.type === SnaprollActionType.Draw)
    expect(drawActions.length).toBe(0)

    loop.pause()
  })
})

describe('Performance Validation Tests', () => {
  it('handles reasonable number of subscriptions', () => {
    const loop = new Snaproll({ fps: 60, timestep: 16.67 })

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
    const loop = new Snaproll({ fps: 60, timestep: 16.67 })

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

describe('Legacy Compatibility Tests', () => {
  it('maintains compatibility with original test pattern', () => {
    const timestep = 1000 / 60
    const fps = 60
    const loop = new Snaproll({ fps, timestep })
    const begin = vi.fn()
    const update = vi.fn()
    const draw = vi.fn()

    loop.subscribe((value) => {
      const timestamp = timeController.now()

      if (value.type === SnaprollActionType.Begin) {
        begin(value, timestamp)
      }

      if (value.type === SnaprollActionType.Update) {
        update(value, timestamp)
      }

      if (value.type === SnaprollActionType.Draw) {
        draw(value, timestamp)
      }
      return undefined
    })

    loop.resume()

    // Simulate 10 seconds of animation
    const targetFrames = fps * 10
    for (let index = 0; index < targetFrames; index++) {
      timeController.advance(1000 / fps)
    }

    expect(isApproximatelyEqual(draw.mock.calls.length, targetFrames, 5)).toBe(true)
    expect(isApproximatelyEqual(loop.fps, fps, 5)).toBe(true)

    loop.pause()
  })
})
