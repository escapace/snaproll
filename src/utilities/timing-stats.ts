import { sortNumericAscending } from './sort-numeric-ascending'

const EMPTY_STATS_VALUE = 0

export interface TimingStats {
  coefficientOfVariation: number
  max: number
  mean: number
  median: number
  min: number
  standardDeviation: number
}

export function calculateTimingStats(durations: readonly number[]): TimingStats {
  if (durations.length === 0) {
    return {
      coefficientOfVariation: EMPTY_STATS_VALUE,
      max: EMPTY_STATS_VALUE,
      mean: EMPTY_STATS_VALUE,
      median: EMPTY_STATS_VALUE,
      min: EMPTY_STATS_VALUE,
      standardDeviation: EMPTY_STATS_VALUE,
    }
  }

  const sorted = sortNumericAscending(durations as number[])
  const sum = durations.reduce((accumulator, value) => accumulator + value, 0)
  const mean = sum / durations.length
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]

  const variance =
    durations.reduce((accumulator, value) => accumulator + Math.pow(value - mean, 2), 0) /
    durations.length
  const standardDeviation = Math.sqrt(variance)
  const coefficientOfVariation = mean !== 0 ? standardDeviation / mean : 0

  return {
    coefficientOfVariation,
    max: sorted[sorted.length - 1],
    mean,
    median,
    min: sorted[0],
    standardDeviation,
  }
}
