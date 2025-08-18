import { withPromise } from '@escapace/with-promise'
import { assert, beforeEach, describe, expect, it } from 'vitest'
import { collectPeriods, type CollectPeriodsOptions } from './collect-periods'
import { MockTimeController } from './utilities/mock-time-controller'

let timeController: MockTimeController

function setupTimeController(): void {
  timeController = new MockTimeController()
}

function generateUniformPeriods(count: number, period: number): number[] {
  return Array.from({ length: count }, () => period)
}

function expectPeriodsEqual(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length)
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index]).toBeCloseTo(expected[index], 3)
  }
}

// eslint-disable-next-line typescript/promise-function-async
function runCollectPeriods(options: CollectPeriodsOptions, periods: number[]) {
  const request = withPromise(options, collectPeriods)

  // eslint-disable-next-line typescript/prefer-for-of
  for (let index = 0; index < periods.length; index++) {
    timeController.advance(periods[index])
  }

  return request
}

describe('collectPeriods', () => {
  beforeEach(setupTimeController)

  it('collects periods from timestamps', async () => {
    const samples = 5
    const warmup = 2
    const period = 16.67
    const totalFrames = warmup + samples + 1
    const framePeriods = generateUniformPeriods(totalFrames, period)

    const result = await runCollectPeriods({ samples, warmup }, framePeriods)

    assert(result.state === 'fulfilled')
    expectPeriodsEqual(result.value, Array(samples).fill(period) as number[])
  })

  it('excludes warmup periods from results', async () => {
    const samples = 3
    const warmup = 2
    const warmupPeriod = 50
    const samplePeriod = 16.67

    const framePeriods = [
      ...generateUniformPeriods(warmup, warmupPeriod),
      ...generateUniformPeriods(samples + 1, samplePeriod),
    ]

    const result = await runCollectPeriods({ samples, warmup }, framePeriods)

    assert(result.state === 'fulfilled')
    expectPeriodsEqual(result.value, Array(samples).fill(samplePeriod) as number[])
  })

  it('handles zero warmup correctly', async () => {
    const samples = 4
    const warmup = 0
    const period = 8.33
    const framePeriods = generateUniformPeriods(samples + 1, period)

    const result = await runCollectPeriods({ samples, warmup }, framePeriods)

    assert(result.state === 'fulfilled')
    expect(result.value).toHaveLength(samples)
    expectPeriodsEqual(result.value, Array(samples).fill(period) as number[])
  })

  it('cancels collection early', async () => {
    const samples = 10
    const warmup = 2

    const request = withPromise({ samples, warmup }, collectPeriods)

    setTimeout(() => {
      void request.cancel()
    }, 0)

    const result = await request

    expect(result.state).toBe('cancelled')
  })

  it('cancels mid-collection', async () => {
    const samples = 10
    const warmup = 2
    const period = 16.67

    const request = withPromise({ samples, warmup }, collectPeriods)

    timeController.advance(period)
    timeController.advance(period)
    timeController.advance(period)

    void request.cancel()

    const result = await request

    expect(result.state).toBe('cancelled')
  })
  it('resolves normally when not cancelled', async () => {
    const samples = 3
    const warmup = 1
    const period = 16.67
    const framePeriods = generateUniformPeriods(samples + warmup + 1, period)

    const result = await runCollectPeriods({ samples, warmup }, framePeriods)

    assert(result.state === 'fulfilled')
    expect(result.value).toHaveLength(samples)
  })
  it('handles minimum sample count', async () => {
    const samples = 1
    const warmup = 0
    const period = 16.67
    const framePeriods = generateUniformPeriods(samples + 1, period)

    const result = await runCollectPeriods({ samples, warmup }, framePeriods)

    assert(result.state === 'fulfilled')
    expect(result.value).toHaveLength(1)
    expect(result.value[0]).toBeCloseTo(period, 3)
  })

  it('handles minimum sample count', async () => {
    const samples = 0
    const warmup = 0
    const period = 16.67
    const framePeriods = generateUniformPeriods(samples + 1, period)

    const result = await runCollectPeriods({ samples, warmup }, framePeriods)

    assert(result.state === 'fulfilled')
    expect(result.value).toHaveLength(0)
  })
})
