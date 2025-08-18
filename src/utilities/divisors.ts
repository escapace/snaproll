import { isNearInteger } from './is-near-integer'

export function divisors(numerator: number, maxDivisor: number, minValue: number): number[] {
  const raw: number[] = []

  for (let divisor = 1; divisor <= maxDivisor; divisor++) {
    const value = numerator / divisor
    if (value < minValue) break

    if (!isNearInteger(value)) {
      continue
    }

    // Round to nearest integer for floating-point precision safety
    raw.push(Math.round(value))
  }

  // Deduplicate
  const deduped: number[] = []
  for (const value of raw) {
    if (!deduped.includes(value)) {
      deduped.push(value)
    }
  }

  // Sort descending
  return deduped.sort((a, b) => b - a)
}
