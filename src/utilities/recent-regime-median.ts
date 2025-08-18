import { quantileTypeSeven } from './quantile-type-seven'
import { median } from './median'
import { sortNumericAscending } from './sort-numeric-ascending'

export function recentRegimeMedian(values: number[]): number | undefined {
  // Split the data once; keep the same recent-bias as before but decide flips symmetrically.
  const midpoint = Math.floor(values.length / 2)
  if (midpoint < 3) {
    return undefined
  }

  const firstHalf = values.slice(0, midpoint)
  const secondHalf = values.slice(midpoint)

  // Symmetric regime decision: if the IQRs (central 50% bands) are disjoint,
  // treat it as a true shift and prefer the recent half; otherwise use the overall median.
  const firstSorted = sortNumericAscending(firstHalf)
  const secondSorted = sortNumericAscending(secondHalf)

  const firstQuartileFirstHalf = quantileTypeSeven(firstSorted, 0.25)
  const thirdQuartileFirstHalf = quantileTypeSeven(firstSorted, 0.75)

  const firstQuartileSecondHalf = quantileTypeSeven(secondSorted, 0.25)
  const thirdQuartileSecondHalf = quantileTypeSeven(secondSorted, 0.75)

  const overlapStart = Math.max(firstQuartileFirstHalf, firstQuartileSecondHalf)
  const overlapEnd = Math.min(thirdQuartileFirstHalf, thirdQuartileSecondHalf)
  const intervalsOverlap = overlapEnd - overlapStart >= 0

  if (!intervalsOverlap) {
    return median(secondSorted)
  }

  return undefined
}
