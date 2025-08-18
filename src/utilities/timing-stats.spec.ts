import { describe, expect, it } from 'vitest'
import { calculateTimingStats, type TimingStats } from './timing-stats'

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

function expectEmptyStats(stats: TimingStats): void {
  expect(stats.mean).toBe(0)
  expect(stats.median).toBe(0)
  expect(stats.min).toBe(0)
  expect(stats.max).toBe(0)
  expect(stats.standardDeviation).toBe(0)
  expect(stats.coefficientOfVariation).toBe(0)
}

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
