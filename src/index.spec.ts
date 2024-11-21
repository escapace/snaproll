import { deferred } from '@escapace/sequentialize'
import { max, mean, median, min, standardDeviation } from 'simple-statistics'
import { assert, describe, it, vi } from 'vitest'
import {
  Snaproll,
  SnaprollActionType,
  type SnaprollActionBegin,
  type SnaprollActionDraw,
  type SnaprollActionUpdate,
} from './index'

// async function delay(ms: number): Promise<void> {
//   return await new Promise((resolve) => setTimeout(resolve, ms))
// }

function isApproximatelyEqual(a: number, b: number, epsilon = 1e-10): boolean {
  return Math.abs(a - b) <= epsilon
}

globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
  const reference = setTimeout(() => callback(performance.now()), 1000 / 60)
  return reference as unknown as number
  // // eslint-disable-next-line typescript/no-non-null-assertion
  // const id = Reflect.ownKeys(reference).find((value) => value.toString() === 'Symbol(asyncId)')!
  // return reference[id as keyof typeof reference] as unknown as number
}
globalThis.cancelAnimationFrame = clearTimeout

const createPerformanceObserver = () => {
  const durations: number[] = []

  performance.clearMarks()
  performance.clearMeasures()

  const observer = new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => {
      if (entry.entryType === 'measure' && entry.name === 'snaproll-animate') {
        durations.push(entry.duration)
      }
    })
  })

  observer.observe({ entryTypes: ['measure'] })

  const disconnect = () => {
    observer.disconnect()
    performance.clearMarks()
    performance.clearMeasures()
  }

  return { disconnect, durations }
}

const createScenario = async () => {
  const { disconnect, durations } = createPerformanceObserver()

  const timestep = 1000 / 60
  const fps = 60
  const loop = new Snaproll({ fps, timestep })
  const begin = vi.fn<(a: SnaprollActionBegin, b: number) => void>()
  const update = vi.fn<(a: SnaprollActionUpdate, b: number) => void>()
  const draw = vi.fn<(a: SnaprollActionDraw, b: number) => void>()
  const done = deferred()

  loop.subscribe((value) => {
    if (value.type === SnaprollActionType.Begin) {
      begin(value, performance.now())
    }

    if (value.type === SnaprollActionType.Update) {
      update(value, performance.now())
    }

    if (value.type === SnaprollActionType.Draw) {
      draw(value, performance.now())

      if (draw.mock.calls.length === fps * 10) {
        done.resolve()
      }
    }
  })

  loop.resume()

  await done.promise

  assert.ok(isApproximatelyEqual(draw.mock.calls.length, fps * 10, 5))
  assert.ok(isApproximatelyEqual(loop.fps, fps, 5))
  loop.pause()
  disconnect()

  return { begin, draw, durations, fps: loop.fps, update }
}

describe('snaproll', () => {
  it('requestAnimationFrame', async () => {
    const done = deferred()

    requestAnimationFrame(() => {
      done.resolve()
    })

    await done.promise
  })

  it('cancelAnimationFrame', async () =>
    await new Promise((resolve, reject) => {
      const id = requestAnimationFrame(() => {
        reject(new Error('Should be cancelled'))
      })

      cancelAnimationFrame(id)

      assert.ok(id !== undefined)
      assert.ok(id !== null)

      setTimeout(resolve, 100)
    }))

  it('snaproll', { timeout: 20 * 1000 }, async () => {
    const { durations, fps } = await createScenario()

    console.log('Median', median(durations))
    console.log('Mean', mean(durations))
    console.log('Min', min(durations))
    console.log('Max', max(durations))
    console.log('SD', standardDeviation(durations))
    console.log('FPS', fps)
  })
})
