import { describe, expect, it } from 'vitest'
import { assert } from './assert'
import { median } from './median'

const MEDIAN_TEST_DATA = {
  BASIC_FUNCTIONALITY: [
    { description: 'empty array', expected: undefined, input: [] },
    { description: 'single element', expected: 5, input: [5] },
    { description: 'odd length array', expected: 2, input: [1, 2, 3] },
    { description: 'even length array', expected: 2.5, input: [1, 2, 3, 4] },
    { description: 'two elements', expected: 1.5, input: [1, 2] },
  ],

  ODD_LENGTH_CASES: [
    { expected: 10, input: [10] },
    { expected: 5, input: [1, 5, 9] },
    { expected: 6, input: [2, 4, 6, 8, 10] },
    { expected: 5, input: [-5, 0, 5, 10, 15] },
  ],

  EVEN_LENGTH_CASES: [
    { expected: 2, input: [1, 3] },
    { expected: 5, input: [2, 4, 6, 8] },
    { expected: 0, input: [-10, -5, 5, 10] },
    { expected: 3.5, input: [1, 2, 3, 4, 5, 6] },
  ],

  MATHEMATICAL_PROPERTIES: {
    TRANSLATION_INVARIANCE: [
      { description: 'positive translation', original: [1, 2, 3], translation: 10 },
      { description: 'negative translation', original: [5, 10, 15], translation: -3 },
      { description: 'large translation', original: [0, 1, 2], translation: 100 },
    ],

    MONOTONICITY: [
      { after: [2, 3, 4], before: [1, 2, 3], description: 'uniform increase' },
      { after: [6, 11, 16], before: [5, 10, 15], description: 'uniform increase different values' },
      { after: [-4, 1, 6], before: [-5, 0, 5], description: 'uniform increase with negatives' },
    ],

    ORDER_STATISTICS: [
      { description: 'middle of consecutive integers', expectedMedian: 3, input: [1, 2, 3, 4, 5] },
      {
        description: 'middle of seven elements',
        expectedMedian: 40,
        input: [10, 20, 30, 40, 50, 60, 70],
      },
      { description: 'average of two elements', expectedMedian: 150, input: [100, 200] },
    ],
  },

  EDGE_CASES: [
    { description: 'all identical elements', expected: 5, input: [5, 5, 5] },
    { description: 'all identical elements (even)', expected: 1, input: [1, 1, 1, 1] },
    { description: 'all negative numbers', expected: -5, input: [-10, -5, -1] },
    { description: 'symmetric around zero', expected: 0, input: [-2, -1, 0, 1, 2] },
    { description: 'floating point numbers', expected: 2.2, input: [1.1, 2.2, 3.3] },
    {
      description: 'small floating point average',
      expected: 0.15,
      input: [0.1, 0.2],
      useCloseTo: true,
    },
  ],

  ROBUSTNESS_OUTLIERS: [
    { description: 'large outlier', expected: 2.5, input: [1, 2, 3, 1000] },
    { description: 'negative outlier', expected: 1.5, input: [-1000, 1, 2, 3] },
    {
      description: 'extreme outlier in larger set',
      expected: 3.5,
      input: [1, 2, 3, 4, 5, 1_000_000],
    },
  ],
}

describe('median', () => {
  it.each(MEDIAN_TEST_DATA.BASIC_FUNCTIONALITY)(
    'handles $description correctly',
    ({ expected, input }) => {
      expect(median(input)).toBe(expected)
    },
  )

  it.each(MEDIAN_TEST_DATA.ODD_LENGTH_CASES)(
    'returns middle element for odd-length sorted array: $input',
    ({ expected, input }) => {
      expect(median(input)).toBe(expected)
    },
  )

  it.each(MEDIAN_TEST_DATA.EVEN_LENGTH_CASES)(
    'returns average of middle elements for even-length sorted array: $input',
    ({ expected, input }) => {
      expect(median(input)).toBe(expected)
    },
  )

  describe('mathematical properties', () => {
    it.each(MEDIAN_TEST_DATA.MATHEMATICAL_PROPERTIES.TRANSLATION_INVARIANCE)(
      'satisfies translation invariance: $description',
      ({ original, translation }) => {
        const originalMedian = median(original)
        const translatedArray = original.map((x) => x + translation)
        const translatedMedian = median(translatedArray)

        assert(originalMedian !== undefined, 'originalMedian should not be undefined')
        assert(translatedMedian !== undefined, 'translatedMedian should not be undefined')
        expect(translatedMedian).toBe(originalMedian + translation)
      },
    )

    it.each(MEDIAN_TEST_DATA.MATHEMATICAL_PROPERTIES.MONOTONICITY)(
      'satisfies monotonicity property: $description',
      ({ after, before }) => {
        const medianBefore = median(before)
        const medianAfter = median(after)

        assert(medianBefore !== undefined, 'medianBefore should not be undefined')
        assert(medianAfter !== undefined, 'medianAfter should not be undefined')
        expect(medianAfter).toBeGreaterThanOrEqual(medianBefore)
      },
    )

    it.each(MEDIAN_TEST_DATA.MATHEMATICAL_PROPERTIES.ORDER_STATISTICS)(
      'correctly identifies 50th percentile: $description',
      ({ expectedMedian, input }) => {
        expect(median(input)).toBe(expectedMedian)

        const actualMedian = median(input)
        assert(actualMedian !== undefined, 'actualMedian should not be undefined')
        const belowOrEqual = input.filter((x) => x <= actualMedian).length
        const aboveOrEqual = input.filter((x) => x >= actualMedian).length

        expect(belowOrEqual).toBeGreaterThanOrEqual(input.length / 2)
        expect(aboveOrEqual).toBeGreaterThanOrEqual(input.length / 2)
      },
    )
  })

  it.each(MEDIAN_TEST_DATA.EDGE_CASES)(
    'handles edge case: $description',
    ({ expected, input, useCloseTo }) => {
      const actualMedian = median(input)
      const matchesExpected =
        useCloseTo === true ? Math.abs(actualMedian - expected) < 1e-10 : actualMedian === expected

      expect(matchesExpected).toBe(true)
    },
  )

  it.each(MEDIAN_TEST_DATA.ROBUSTNESS_OUTLIERS)(
    'demonstrates robustness to outliers: $description',
    ({ expected, input }) => {
      expect(median(input)).toBe(expected)

      const medianValue = median(input)
      assert(medianValue !== undefined, 'medianValue should not be undefined')
      const mean = input.reduce((sum, x) => sum + x, 0) / input.length

      expect(Math.abs(medianValue - mean)).toBeGreaterThan(0)
    },
  )

  it('maintains precision with floating-point arithmetic', () => {
    const values = [0.1, 0.2, 0.3, 0.4]
    const result = median(values)

    expect(result).toBeCloseTo(0.25, 10)
  })
})
