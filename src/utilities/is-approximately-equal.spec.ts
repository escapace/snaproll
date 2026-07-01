import { describe, expect, it } from 'vitest'
import { isApproximatelyEqual } from './is-approximately-equal'

const APPROXIMATE_EQUALITY_TEST_DATA = {
  IDENTICAL_PAIRS: [
    [5, 5],
    [0, 0],
    [-10, -10],
  ] as const,

  EPSILON_CASES: [
    { a: 1, b: 1 + 1e-11, description: 'within default epsilon', expected: true },
    { a: 1, b: 1 - 1e-11, description: 'within default epsilon (negative)', expected: true },
    { a: 1, b: 1.1, description: 'outside default epsilon', expected: false },
    { a: 1, b: 1.001, description: 'outside default epsilon (smaller diff)', expected: false },
  ] as const,

  CUSTOM_EPSILON_CASES: [
    { a: 1, b: 1.05, epsilon: 0.1, expected: true },
    { a: 1, b: 1.05, epsilon: 0.01, expected: false },
  ] as const,

  EDGE_CASES: [
    { a: 0, b: 1e-11, description: 'zero vs tiny number', expected: true },
    { a: 1e10, b: 1e10 + 1, description: 'large numbers with unit difference', expected: false },
    { a: -1, b: -1.00000000001, description: 'negative numbers within epsilon', expected: true },
  ] as const,
} as const

describe('isApproximatelyEqual', () => {
  it.each(APPROXIMATE_EQUALITY_TEST_DATA.IDENTICAL_PAIRS)(
    'returns true for identical numbers: %d and %d',
    (a, b) => {
      expect(isApproximatelyEqual(a, b)).toBe(true)
    },
  )

  it.each(APPROXIMATE_EQUALITY_TEST_DATA.EPSILON_CASES)('$description', ({ a, b, expected }) => {
    expect(isApproximatelyEqual(a, b)).toBe(expected)
  })

  it.each(APPROXIMATE_EQUALITY_TEST_DATA.CUSTOM_EPSILON_CASES)(
    'respects custom epsilon: $a vs $b with epsilon $epsilon',
    ({ a, b, epsilon, expected }) => {
      expect(isApproximatelyEqual(a, b, epsilon)).toBe(expected)
    },
  )

  it.each(APPROXIMATE_EQUALITY_TEST_DATA.EDGE_CASES)(
    'handles edge case: $description',
    ({ a, b, expected }) => {
      expect(isApproximatelyEqual(a, b)).toBe(expected)
    },
  )
})
