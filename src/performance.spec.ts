import { describe, expect, it } from 'vitest'
import { Snaproll } from './index'
import { MockTimeController } from './test-utilities'

const callback = (): undefined => undefined

function runAnimationBenchmark(
  snaprollFps: number,
  timeControllerFps: number,
  targetFrames: number,
  subscriptionCount: number,
): number {
  const timeController = new MockTimeController()

  const loop = new Snaproll({ fps: snaprollFps, timestep: 1000 / snaprollFps })

  // Add multiple subscriptions
  for (let index = 0; index < subscriptionCount; index++) {
    loop.subscribe(callback)
  }

  loop.resume()
  timeController.advance(0.001)

  const frameInterval = 1000 / timeControllerFps

  const startTime = performance.now()

  for (let index = 0; index < targetFrames; index++) {
    timeController.advance(frameInterval)
  }

  const endTime = performance.now()
  loop.pause()

  return endTime - startTime
}

describe('Core Animation Loop Performance', () => {
  it(
    'measures performance for different fps and subscription configurations',
    { timeout: 30_000 },
    () => {
      const targetFrames = 1000
      const iterations = 1000

      const fpsConfigs = [
        { name: '30fps snaproll, 30fps timeController', snaprollFps: 30, timeControllerFps: 30 },
        { name: '30fps snaproll, 60fps timeController', snaprollFps: 30, timeControllerFps: 60 },
        { name: '60fps snaproll, 30fps timeController', snaprollFps: 60, timeControllerFps: 30 },
        { name: '60fps snaproll, 60fps timeController', snaprollFps: 60, timeControllerFps: 60 },
      ]

      const subscriptionCounts = [1, 5, 10, 20, 100]

      console.log(`\nPerformance Results (${targetFrames} frames, ${iterations} iterations):\n`)

      for (const fpsConfig of fpsConfigs) {
        console.log(`${fpsConfig.name}:`)

        for (const subscriptionCount of subscriptionCounts) {
          const times: number[] = []

          for (let index = 0; index < iterations; index++) {
            performance.clearMarks()
            const time = runAnimationBenchmark(
              fpsConfig.snaprollFps,
              fpsConfig.timeControllerFps,
              targetFrames,
              subscriptionCount,
            )
            times.push(time)
          }

          const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length
          const minTime = Math.min(...times)
          const maxTime = Math.max(...times)

          console.log(`  ${subscriptionCount} subscription${subscriptionCount === 1 ? '' : 's'}:`)
          console.log(`    Average: ${avgTime.toFixed(6)}ms`)
          console.log(`    Min: ${minTime.toFixed(6)}ms`)
          console.log(`    Max: ${maxTime.toFixed(6)}ms`)
          console.log(`    Per frame: ${(avgTime / targetFrames).toFixed(8)}ms`)
        }
        console.log('')
      }

      // Just verify the benchmark ran
      expect(true).toBe(true)
    },
  )
})
