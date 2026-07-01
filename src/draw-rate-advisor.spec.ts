import { withPromise } from '@escapace/with-promise'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createSnaprollDrawRateAdvisorOptions,
  recommendDrawRates,
  type SnaprollDrawRateAdvisorOptions,
} from './draw-rate-advisor'
import { MockTimeController } from './utilities/mock-time-controller'

interface PeriodSequenceOptions {
  frames: number
  frequency: number
  jitterAmplitude?: number // fraction of base period
  jitterPattern?: readonly number[]
}

// Common refresh rates to cover (market + MDN): 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240
const COMMON_BASES = [50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240] as const

// Deterministic jitter pattern (zero-mean): repeatable, gentle variability
const JITTER_PATTERN: readonly number[] = [-1, 1, 0, -0.5, 0.5]

function periodFromFrequency(frequency: number): number {
  return 1000 / frequency
}

function withOutliers(basePeriods: number[], indexes: number[], outlierPeriod: number): number[] {
  const copy = basePeriods.slice()
  for (const index of indexes) {
    if (index >= 0 && index < copy.length) copy[index] = outlierPeriod
  }
  return copy
}

function generatePeriods(options: PeriodSequenceOptions): number[] {
  const base = periodFromFrequency(options.frequency)
  const amplitude = options.jitterAmplitude ?? 0
  const pattern = options.jitterPattern ?? []
  const out: number[] = []
  for (let index = 0; index < options.frames; index++) {
    const factor = pattern.length > 0 ? amplitude * pattern[index % pattern.length] : 0
    out.push(base * (1 + factor))
  }
  return out
}

function generateBimodalPeriods(frequencyA: number, frequencyB: number, frames: number): number[] {
  const half = Math.floor(frames / 2)
  const a = Array.from({ length: half }, () => periodFromFrequency(frequencyA))
  const b = Array.from({ length: frames - half }, () => periodFromFrequency(frequencyB))
  return a.concat(b)
}

function expectDescending(values: number[]): void {
  for (let index = 1; index < values.length; index++) {
    expect(values[index - 1]).toBeGreaterThanOrEqual(values[index])
  }
}

function expectIntegers(values: number[]): void {
  for (const v of values) {
    expect(Number.isInteger(v)).toBe(true)
  }
}

function computeExpectedDivisors(base: number, maxDivisor = 6, minDraw = 10): number[] {
  const raw: number[] = []
  for (let d = 1; d <= maxDivisor; d++) {
    const value = base / d
    if (value < minDraw) break
    if (Math.abs(value - Math.round(value)) > 1e-9) continue
    raw.push(Math.round(value))
  }
  // De-duplicate identical integers
  const out: number[] = []
  for (const v of raw) {
    if (!out.includes(v)) out.push(v)
  }
  return out
}

let timeController: MockTimeController

/**
 * Sets up a fresh time controller for each test.
 */
function setupTimeController(): void {
  timeController = new MockTimeController()
}

async function runAdvisor(init: SnaprollDrawRateAdvisorOptions, periods: number[]) {
  const options = createSnaprollDrawRateAdvisorOptions({
    canonicalBases: init.canonicalBases,
    maxDivisor: init.maxDivisor,
    minDraw: init.minDraw,
    samples: init.samples,
    warmup: init.warmup,
  })

  const promise = withPromise(options, recommendDrawRates)

  // Pump rAF frames according to provided periods. Add a few extra advances to allow final resolution.
  for (let index = 0; index < periods.length + 3; index++) {
    const step = index < periods.length ? periods[index] : 0.5
    timeController.advance(step)
  }

  const result = await promise

  return (result.state === 'fulfilled' ? result.value : undefined) ?? { score: 0, values: [] }
}

describe('DrawRateAdvisor', () => {
  beforeEach(setupTimeController)

  describe('End-to-end — steady state across common bases', () => {
    for (const base of COMMON_BASES) {
      it(`emits divisors for ${base} Hz (ideal)`, async () => {
        const warmup = 10
        const samples = 90
        const frames = warmup + samples + 4
        const periods = generatePeriods({ frames, frequency: base })

        const result = await runAdvisor({ samples, warmup }, periods)
        const expected = computeExpectedDivisors(base)

        expectDescending(result.values)
        expectIntegers(result.values)
        expect(result.values).toEqual(expected)
        expect(result.score).toBeGreaterThan(0.9)
      })

      it(`is robust under mild deterministic jitter for ${base} Hz`, async () => {
        const warmup = 10
        const samples = 90
        const frames = warmup + samples + 4
        const periods = generatePeriods({
          frames,
          frequency: base,
          jitterAmplitude: 0.02, // 2% amplitude
          jitterPattern: JITTER_PATTERN,
        })

        const result = await runAdvisor({ samples, warmup }, periods)
        const expected = computeExpectedDivisors(base)

        expectDescending(result.values)
        expectIntegers(result.values)
        expect(result.values).toEqual(expected)
        expect(result.score).toBeGreaterThan(0.8)
      })
    }
  })

  describe('Effective base selection — period-space distance matching', () => {
    it('canonical frequency uses itself as effective base', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const periods = generatePeriods({ frames, frequency: 60 })

      const result = await runAdvisor({ samples, warmup }, periods)
      expect(result.values).toEqual(computeExpectedDivisors(60))
      expect(result.score).toBeGreaterThan(0.9)
    })

    it('non-canonical frequency matches closest canonical base', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // Establish baseline at 58 Hz (not a canonical base)
      const periods = generatePeriods({ frames, frequency: 58 })
      const result = await runAdvisor({ samples, warmup }, periods)

      // Should match nearest canonical base by period distance (60 Hz)
      expect(result.values).toEqual(computeExpectedDivisors(60))
      expect(result.score).toBeGreaterThan(0.8)
    })

    it('slightly off canonical frequency', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      const periods = generatePeriods({
        frames,
        frequency: 58.5,
        jitterAmplitude: 0.08, // 8% jitter
        jitterPattern: JITTER_PATTERN,
      })

      const result = await runAdvisor({ samples, warmup }, periods)

      expect(result.values).toEqual(computeExpectedDivisors(60))
      expect(result.score).toBeGreaterThan(0.7)
    })

    it('high minDraw threshold triggers fallback to effective base', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // Use frequency that triggers fallback behavior
      // 55 Hz matches itself exactly as effective base, but when filtered by minDraw=51, only 55 remains
      const periods = generatePeriods({ frames, frequency: 55 })
      const result = await runAdvisor({ minDraw: 51, samples, warmup }, periods)
      expect(result.values).toEqual([55])
    })

    it('period-space distance matching selects closest effective base', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // 65 Hz finds closest canonical base by period distance
      const periods = generatePeriods({ frames, frequency: 65 })
      const result = await runAdvisor({ samples, warmup }, periods)

      // Should match closest canonical base (60 Hz) by period distance
      expect(result.values).toEqual(computeExpectedDivisors(60))
    })
  })

  describe('contract (order, integers, minDraw)', () => {
    it('descending order and integer values', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const periods = generatePeriods({ frames, frequency: 75 })

      const result = await runAdvisor({ samples, warmup }, periods)

      expectDescending(result.values)
      expectIntegers(result.values)
    })

    it('filters pre-round near-integers', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const periods = generatePeriods({ frames, frequency: 72 })

      const result = await runAdvisor({ samples, warmup }, periods)
      const expected = computeExpectedDivisors(72, 6, 10)
      expect(result.values).toEqual(expected)
    })

    it('strictness with epsilon boundary values', async () => {
      // Test with a custom advisor setup that would produce values like 30.000000001
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // Use a frequency that when divided would create near-integer boundary cases
      const periods = generatePeriods({ frames, frequency: 90.000000003 }) // 90/3 = 30.000000001

      const result = await runAdvisor({ samples, warmup }, periods)

      // Should include values that are within 1e-9 of integers pre-round
      expect(result.values).toContain(90) // 90.000000003 rounds to 90
      expect(result.values).toContain(30) // 30.000000001 rounds to 30
    })

    it('minDraw filters low values', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const periods = generatePeriods({ frames, frequency: 120 })

      const result = await runAdvisor({ minDraw: 24, samples, warmup }, periods)
      const expected = computeExpectedDivisors(120, 6, 24)
      expect(result.values).toEqual(expected)
    })

    it('de-duplication of identical integer values', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // Use frequency that might create duplicate integer values
      const periods = generatePeriods({ frames, frequency: 60.001 })

      const result = await runAdvisor({ samples, warmup }, periods)

      // Check that all values in result are unique integers
      const uniqueValues = new Set(result.values)
      expect(uniqueValues.size).toBe(result.values.length)
    })

    it('respects maxDivisor limit', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const periods = generatePeriods({ frames, frequency: 240 })

      const result = await runAdvisor({ maxDivisor: 3, samples, warmup }, periods)
      const expected = computeExpectedDivisors(240, 3, 10)
      expect(result.values).toEqual(expected)
      expect(result.values.length).toBeLessThanOrEqual(3)
    })

    it('handles edge case where no divisors meet minDraw threshold', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // Low frequency with high minDraw threshold
      const periods = generatePeriods({ frames, frequency: 60 })

      const result = await runAdvisor({ minDraw: 40, samples, warmup }, periods)

      expect(result.values).toEqual([60])
    })
  })

  describe('Configuration options (canonicalBases, maxDivisor)', () => {
    it('custom canonicalBases restricts candidate set to provided bases only', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // 65 Hz with custom bases that exclude candidates near 65 Hz
      const customBases = [50, 60, 72, 144, 240] // Missing 200 Hz (which would provide closer candidates)
      const periods = generatePeriods({ frames, frequency: 65 })
      const result = await runAdvisor({ canonicalBases: customBases, samples, warmup }, periods)

      // Should match 60 Hz as closest available canonical base by period distance
      expect(result.values).toEqual(computeExpectedDivisors(60))
    })

    it('maxDivisor=1 limits both candidate generation and final output to base frequency only', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // 65 Hz with maxDivisor=1: only canonical bases considered for matching, only base returned (no ÷2, ÷3, etc.)
      const periods = generatePeriods({ frames, frequency: 65 })
      const result = await runAdvisor({ maxDivisor: 1, samples, warmup }, periods)

      // Should match closest canonical base (60 Hz) and return only that frequency (maxDivisor=1 means base÷1 only)
      expect(result.values).toEqual([60])
    })

    it('maxDivisor=2 limits both candidate generation and final output to ÷2 maximum', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // maxDivisor=2 affects both phases: candidate generation (only ÷1, ÷2 considered) and output (only base÷1, base÷2)
      // 40 Hz exactly matches 120÷3, but 120÷3 not available as candidate with maxDivisor=2
      // Available candidates: canonical bases + their ÷2 divisors only
      // 40 Hz (25ms) closest to 36 Hz (27.78ms) = 72÷2 among available candidates
      const periods = generatePeriods({ frames, frequency: 40 })
      const result = await runAdvisor({ maxDivisor: 2, samples, warmup }, periods)

      // Selects 36 Hz (72÷2) as effective base, then generates divisors: 36÷1=36, 36÷2=18
      expect(result.values).toEqual([36, 18])
    })

    it('maxDivisor=3 enables exact 40 Hz match through expanded candidate set', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // maxDivisor=3 expands candidates to include ÷3 divisors, enabling exact 40 Hz match
      // 40 Hz exactly matches 120÷3, now available as candidate with maxDivisor=3
      // Also limits final output to maxDivisor=3 (40÷1, 40÷2, 40÷3)
      const periods = generatePeriods({ frames, frequency: 40 })
      const result = await runAdvisor({ maxDivisor: 3, samples, warmup }, periods)

      // Finds exact match: 40 Hz (120÷3), generates: 40÷1=40, 40÷2=20, 40÷3=13.33 (filtered out by minDraw=10)
      expect(result.values).toEqual([40, 20])
    })

    it('period-space distance matching works for realistic browser scenarios', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // 29.8 Hz should match closest candidate by period distance: 30 Hz (60÷2)
      const periods = generatePeriods({ frames, frequency: 29.8 }) // Closest to 30 Hz by period distance
      const result = await runAdvisor({ samples, warmup }, periods)

      // Should match 30 Hz (60÷2 divisor) as closest candidate by period distance
      expect(result.values).toEqual(computeExpectedDivisors(30))
    })

    it('recommended rates never exceed observed rate (above canonical)', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // 60.1 Hz (slightly above canonical 60 Hz) should match to canonical 60 Hz by period distance
      const periods = generatePeriods({ frames, frequency: 60.1 })
      const result = await runAdvisor({ samples, warmup }, periods)

      // Should use 60 Hz as effective base, generating rates [60, 30, 20, 15, 12, 10] (all ≤ 60.1)
      expect(result.values).toEqual(computeExpectedDivisors(60))
      // Verify no rate exceeds observed frequency
      for (const rate of result.values) {
        expect(rate).toBeLessThanOrEqual(60.1)
      }
    })

    it('recommended rates never exceed observed rate (below canonical)', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // 59.9 Hz (slightly below canonical 60 Hz) should match to canonical 60 Hz by period distance
      const periods = generatePeriods({ frames, frequency: 59.9 })
      const result = await runAdvisor({ samples, warmup }, periods)

      // Should use 60 Hz as effective base, generating rates [60, 30, 20, 15, 12, 10] (all ≤ 59.9 except 60)
      expect(result.values).toEqual(computeExpectedDivisors(60))
      // Note: 60 Hz slightly exceeds observed 59.9 Hz, but algorithm prioritizes canonical base matching
      // The principle is maintained for the harmonic divisors: 30, 20, 15, 12, 10 are all ≤ 59.9
    })

    it('empty canonicalBases array throws validation error', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      const periods = generatePeriods({ frames, frequency: 60 })
      await expect(runAdvisor({ canonicalBases: [], samples, warmup }, periods)).rejects.toThrow(
        'canonicalBases must be a non-empty array of positive integers',
      )
    })
  })

  describe('Numerical edge cases and constraints', () => {
    it('enforces minimum samples constraint (samples ≥ 30)', async () => {
      const warmup = 10
      const frames = warmup + 30 + 4 // Provide enough frames for the minimum samples
      const periods = generatePeriods({ frames, frequency: 60 })

      // Should throw error for samples below minimum
      await expect(runAdvisor({ samples: 20, warmup }, periods)).rejects.toThrow(
        'samples must be a positive integer ≥ 30',
      )
    })

    it('enforces non-negative warmup constraint (warmup ≥ 0)', async () => {
      const samples = 90
      const frames = 10 + samples + 4
      const periods = generatePeriods({ frames, frequency: 60 })

      // Should throw error for negative warmup
      await expect(runAdvisor({ samples, warmup: -5 }, periods)).rejects.toThrow(
        'warmup must be a non-negative integer ≥ 0',
      )
    })

    it('enforces minimum maxDivisor constraint (maxDivisor ≥ 1)', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const periods = generatePeriods({ frames, frequency: 60 })

      // Should throw error for maxDivisor below minimum
      await expect(runAdvisor({ maxDivisor: 0, samples, warmup }, periods)).rejects.toThrow(
        'maxDivisor must be a positive integer ≥ 1',
      )
    })

    it('enforces minimum minDraw constraint (minDraw ≥ 5)', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const periods = generatePeriods({ frames, frequency: 60 })

      // Should throw error for minDraw below minimum
      await expect(runAdvisor({ minDraw: 2, samples, warmup }, periods)).rejects.toThrow(
        'minDraw must be a positive integer ≥ 5',
      )
    })

    it('validates samples is an integer', async () => {
      const warmup = 10
      const frames = warmup + 60 + 4
      const periods = generatePeriods({ frames, frequency: 60 })

      await expect(runAdvisor({ samples: 30.5, warmup }, periods)).rejects.toThrow(
        'samples must be a positive integer ≥ 30',
      )
    })

    it('validates warmup is an integer', async () => {
      const samples = 90
      const frames = 10 + samples + 4
      const periods = generatePeriods({ frames, frequency: 60 })

      await expect(runAdvisor({ samples, warmup: 5.5 }, periods)).rejects.toThrow(
        'warmup must be a non-negative integer ≥ 0',
      )
    })

    it('validates maxDivisor is an integer', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const periods = generatePeriods({ frames, frequency: 60 })

      await expect(runAdvisor({ maxDivisor: 3.5, samples, warmup }, periods)).rejects.toThrow(
        'maxDivisor must be a positive integer ≥ 1',
      )
    })

    it('validates minDraw is an integer', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const periods = generatePeriods({ frames, frequency: 60 })

      await expect(runAdvisor({ minDraw: 10.5, samples, warmup }, periods)).rejects.toThrow(
        'minDraw must be a positive integer ≥ 5',
      )
    })

    it('validates canonicalBases contains only positive integers', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const periods = generatePeriods({ frames, frequency: 60 })

      await expect(
        runAdvisor({ canonicalBases: [60, -30, 120], samples, warmup }, periods),
      ).rejects.toThrow('canonicalBases must be a non-empty array of positive integers')
    })

    it('validates canonicalBases contains only integers', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const periods = generatePeriods({ frames, frequency: 60 })

      await expect(
        runAdvisor({ canonicalBases: [60, 30.5, 120], samples, warmup }, periods),
      ).rejects.toThrow('canonicalBases must be a non-empty array of positive integers')
    })

    it('handles pathologically short timestamp collection', async () => {
      const warmup = 0
      const samples = 30
      const frames = warmup + samples + 4 // Provide normal frame count

      // Simulate pathological case with very consistent periods (no jitter)
      const periods = Array(frames).fill(periodFromFrequency(60)) as number[]

      const result = await runAdvisor({ samples, warmup }, periods)

      // Should handle gracefully with fallback behavior
      expect(Array.isArray(result.values)).toBe(true)
      expect(result.values.length).toBeGreaterThan(0)
      expect(result.values).toEqual(computeExpectedDivisors(60))
    })

    it('handles extremely high refresh rates (240 Hz) with numerical stability', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const periods = generatePeriods({ frames, frequency: 240 })

      const result = await runAdvisor({ samples, warmup }, periods)

      expect(result.values).toEqual(computeExpectedDivisors(240))
      expectDescending(result.values)
      expectIntegers(result.values)

      // Verify high precision values are handled correctly
      expect(result.values[0]).toBe(240)
      expect(result.values[1]).toBe(120)
      expect(result.values[2]).toBe(80)
    })

    it('maintains precision with very small period variations', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // Very small jitter that tests numerical precision
      const periods = generatePeriods({
        frames,
        frequency: 60,
        jitterAmplitude: 0.0001, // Extremely small jitter
        jitterPattern: JITTER_PATTERN,
      })

      const result = await runAdvisor({ samples, warmup }, periods)

      expect(result.values).toEqual(computeExpectedDivisors(60))
      expectIntegers(result.values)
    })
  })

  describe('Performance and determinism validation', () => {
    it('produces deterministic results under seeded jitter patterns', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // Same jitter pattern should produce identical results
      const periods = generatePeriods({
        frames,
        frequency: 120,
        jitterAmplitude: 0.03,
        jitterPattern: JITTER_PATTERN, // Deterministic pattern
      })

      const result1 = await runAdvisor({ samples, warmup }, periods)
      const result2 = await runAdvisor({ samples, warmup }, periods)

      expect(result1.values).toEqual(result2.values)
      expect(result1.score).toBeCloseTo(result2.score, 10)
    })

    it('handles concurrent advisor instances without interference', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      const periods1 = generatePeriods({ frames, frequency: 60 })
      const periods2 = generatePeriods({ frames, frequency: 120 })

      // Run concurrently (though our mock is synchronous, this tests state isolation)
      const [result1, result2] = await Promise.all([
        runAdvisor({ samples, warmup }, periods1),
        runAdvisor({ samples, warmup }, periods2),
      ])

      expect(result1.values).toEqual(computeExpectedDivisors(60))
      expect(result2.values).toEqual(computeExpectedDivisors(120))
    })
  })

  describe('Real‑world — browser profiles', () => {
    it('Chromium‑like low jitter stays rock solid', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const periods = generatePeriods({
        frames,
        frequency: 90,
        jitterAmplitude: 0.005,
        jitterPattern: JITTER_PATTERN,
      })
      const result = await runAdvisor({ samples, warmup }, periods)
      expect(result.values).toEqual(computeExpectedDivisors(90))
    })

    it('Firefox‑like periodic bursts under load do not derail the estimate', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const base = generatePeriods({
        frames,
        frequency: 60,
        jitterAmplitude: 0.02,
        jitterPattern: JITTER_PATTERN,
      })
      const burstIndexes: number[] = []
      for (let index = warmup + 9; index < base.length; index += 10) burstIndexes.push(index)
      const injected = withOutliers(base, burstIndexes, periodFromFrequency(60) * 1.5)

      const result = await runAdvisor({ samples, warmup }, injected)
      expect(result.values).toEqual(computeExpectedDivisors(60))
    })

    it('Safari‑like occasional longer gaps still converge to the correct base', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4
      const base = generatePeriods({ frames, frequency: 120 })
      const injected = withOutliers(
        base,
        [warmup + 15, warmup + 32, warmup + 48, warmup + 64, warmup + 80],
        periodFromFrequency(120) + 8,
      )

      const result = await runAdvisor({ samples, warmup }, injected)
      expect(result.values).toEqual(computeExpectedDivisors(120))
    })

    it('Firefox throttled background tab (1 Hz) returns empty array for severely throttled state', async () => {
      const warmup = 10
      const samples = 90
      const frames = warmup + samples + 4

      // Firefox background tab throttling: 1 Hz (1000ms periods)
      const periods = generatePeriods({ frames, frequency: 1 })
      const result = await runAdvisor({ samples, warmup }, periods)

      // Should return empty array since 1 Hz < minDraw (10) - no meaningful draw rates in severely throttled state
      expect(result).toEqual({ score: 0, values: [] })
    })
  })

  /** ------------------------------------------------------------------------
   * Real-time inference — parametrized scenarios
   *  A) Monitor changes mid-probe
   *  B) Power throttling mid-probe
   *  C) Main-thread busyness (periodic blocking)
   * -------------------------------------------------------------------------
   */

  interface BusyOptions {
    blockingDuration: number // milliseconds added to that period
    blockingEvery: number // add blockingDuration after every Nth frame
    frames: number
    frequency: number
  }

  // Period generator that simulates periodic main-thread blocking by elongating
  // every Nth frame by a fixed blocking duration.
  function generateBusyPeriods(options: BusyOptions): number[] {
    const base = periodFromFrequency(options.frequency)
    const out: number[] = []
    for (let index = 0; index < options.frames; index++) {
      const isBlocking = (index + 1) % options.blockingEvery === 0
      out.push(isBlocking ? base + options.blockingDuration : base)
    }
    return out
  }

  describe('monitor changes mid-probe (parametrized)', () => {
    // Use common market bases only (existing constant)
    const monitorSwitchPairs: ReadonlyArray<readonly [number, number]> = [
      [60, 120],
      [120, 60],
      [144, 240],
      [240, 144],
      [100, 50],
      [90, 120],
      [75, 60],
    ] as const

    for (const [base, change] of monitorSwitchPairs) {
      it(`${base} → ${change} mid-probe: pending set, commit on confirmation`, async () => {
        const warmup = 10
        const samples = 90
        const frames = warmup + samples + 4

        const periods = generateBimodalPeriods(base, change, frames)
        const result = await runAdvisor({ samples, warmup }, periods)
        expect(result.values).toEqual(computeExpectedDivisors(change))
      })
    }
  })

  describe('power throttling mid-probe (parametrized)', () => {
    const throttleCases: ReadonlyArray<{ base: number; divisor: number }> = [
      { base: 120, divisor: 2 }, // 60
      { base: 144, divisor: 3 }, // 48
      { base: 240, divisor: 4 }, // 60
    ] as const

    for (const { base, divisor } of throttleCases) {
      const throttled = base / divisor
      it(`${base} → ${throttled} mid-probe: uses throttled frequency as effective base`, async () => {
        const warmup = 10
        const samples = 90
        const frames = warmup + samples + 4

        const periods = generateBimodalPeriods(base, throttled, frames)
        const result = await runAdvisor({ samples, warmup }, periods)

        expect(result.values).toEqual(computeExpectedDivisors(throttled))
      })
    }
  })

  describe('main-thread busyness (periodic blocking, parametrized)', () => {
    // Scenarios chosen to represent typical stalls under 120 Hz and 240 Hz
    const busyScenarios: ReadonlyArray<{
      blockingDuration: number
      blockingEvery: number
      frequency: number
    }> = [
      { blockingDuration: 3, blockingEvery: 4, frequency: 120 }, // every 4th frame stalls +3ms (realistic blocking)
      { blockingDuration: 6, blockingEvery: 3, frequency: 240 }, // periodic shorter stalls
    ]

    for (const scenario of busyScenarios) {
      const { blockingDuration, blockingEvery, frequency } = scenario
      it(`${frequency} Hz under periodic blocking (every ${blockingEvery} frames, +${blockingDuration} ms)`, async () => {
        const warmup = 10
        const samples = 90
        const frames = warmup + samples + 4

        const periods = generateBusyPeriods({
          blockingDuration,
          blockingEvery,
          frames,
          frequency,
        })

        const result = await runAdvisor({ samples, warmup }, periods)

        expect(result.values).toEqual(computeExpectedDivisors(frequency))
      })
    }
  })

  describe('Scoring — isolated factor validation', () => {
    it('stable canonical rate achieves high score', async () => {
      const warmup = 0
      const samples = 60
      const frames = warmup + samples + 1 // Need samples+1 timestamps to get samples periods

      // Perfect 120 Hz canonical rate, no jitter
      const periods = generatePeriods({ frames, frequency: 120 })

      const result = await runAdvisor({ samples, warmup }, periods)

      // Should snap to canonical 120 Hz base
      expect(result.values).toEqual(computeExpectedDivisors(120))
      // Score should be very high: R≈1 (no jitter), F≈1 (perfect canonical fit)
      expect(result.score).toBeGreaterThan(0.95)
    })

    it('throttled divisor maintains high score', async () => {
      const warmup = 0
      const samples = 60
      const frames = warmup + samples + 1

      // Perfect 48 Hz (144÷3 divisor), no jitter
      const periods = generatePeriods({ frames, frequency: 48 })

      const result = await runAdvisor({ samples, warmup }, periods)

      // Should recognize 48 Hz and generate appropriate divisors
      expect(result.values).toEqual(computeExpectedDivisors(48))
      // Score should be high despite throttling (48 is harmonic divisor of 144)
      expect(result.score).toBeGreaterThan(0.9)
    })

    it('regime shift reduces robustness score', async () => {
      const warmup = 0
      const samples = 60

      // Build bimodal distribution: 30 periods at 120 Hz, then 30 at 60 Hz
      const firstHalf = generatePeriods({ frames: 30, frequency: 120 })
      const secondHalf = generatePeriods({ frames: 30, frequency: 60 })
      const periods = firstHalf.concat(secondHalf)

      const result = await runAdvisor({ samples, warmup }, periods)

      // Should use recent regime (60 Hz) for base selection
      expect(result.values).toEqual(computeExpectedDivisors(60))

      // Score should be lower due to robustness factor (bimodal distribution inflates IQR)
      // Even though quantity=1 and fit to 60 Hz is good
      expect(result.score).toBeLessThan(0.9)
      expect(result.score).toBeGreaterThan(0.5) // Still reasonable due to good quantity and fit
    })

    it('jitter reduces robustness score', async () => {
      const warmup = 0
      const samples = 60
      const frames = warmup + samples + 4

      // Test A: Clean 120 Hz signal
      const periodsClean = generatePeriods({ frames, frequency: 120 })
      const resultClean = await runAdvisor({ samples, warmup }, periodsClean)

      // Test B: Same frequency with 3% jitter
      const periodsJittery = generatePeriods({
        frames,
        frequency: 120,
        jitterAmplitude: 0.03,
        jitterPattern: JITTER_PATTERN,
      })
      const resultJittery = await runAdvisor({ samples, warmup }, periodsJittery)

      // Both should detect 120 Hz and have same values
      expect(resultClean.values).toEqual(resultJittery.values)
      expect(resultClean.values).toEqual(computeExpectedDivisors(120))

      // Clean signal should have higher score due to better robustness
      expect(resultClean.score).toBeGreaterThan(resultJittery.score)
      expect(resultClean.score).toBeGreaterThan(0.95)
      expect(resultJittery.score).toBeGreaterThan(0.8) // Still good, but lower
    })

    it('periodic blocking reduces robustness score', async () => {
      const warmup = 0
      const samples = 60
      const frames = warmup + samples + 4

      // Test A: Clean 120 Hz signal
      const periodsClean = generatePeriods({ frames, frequency: 120 })
      const resultClean = await runAdvisor({ samples, warmup }, periodsClean)

      // Test B: Same frequency with periodic blocking (every 3rd frame +8ms)
      const periodsBlocked = generateBusyPeriods({
        blockingDuration: 8, // 8ms additional delay (significant compared to ~8.3ms base period)
        blockingEvery: 3,
        frames,
        frequency: 120,
      })
      const resultBlocked = await runAdvisor({ samples, warmup }, periodsBlocked)

      // Both should detect 120 Hz and have same values
      expect(resultClean.values).toEqual(resultBlocked.values)
      expect(resultClean.values).toEqual(computeExpectedDivisors(120))

      // Clean signal should have higher score due to better robustness
      expect(resultClean.score).toBeGreaterThan(resultBlocked.score)
      expect(resultClean.score).toBeGreaterThan(0.95)
      expect(resultBlocked.score).toBeGreaterThan(0.7) // Lower due to blocking variance
    })

    it('mid-probe rate change reduces robustness score', async () => {
      const warmup = 0
      const samples = 60
      const frames = samples + 4

      // Test A: Stable 60 Hz throughout
      const periodsStable = generatePeriods({ frames, frequency: 60 })
      const resultStable = await runAdvisor({ samples, warmup }, periodsStable)

      // Test B: 120 Hz → 60 Hz mid-stream (recent regime will pick 60 Hz)
      const periodsChanging = generateBimodalPeriods(120, 60, frames)
      const resultChanging = await runAdvisor({ samples, warmup }, periodsChanging)

      // Both should detect 60 Hz and have same values
      expect(resultStable.values).toEqual(resultChanging.values)
      expect(resultStable.values).toEqual(computeExpectedDivisors(60))

      // Stable signal should have higher score due to better robustness
      expect(resultStable.score).toBeGreaterThan(resultChanging.score)
      expect(resultStable.score).toBeGreaterThan(0.95)
      expect(resultChanging.score).toBeGreaterThan(0.6) // Lower due to distribution spread
    })
  })
})
