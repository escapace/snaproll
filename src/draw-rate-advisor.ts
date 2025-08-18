import { withPromise, type WithPromise } from '@escapace/with-promise'
import { remove } from 'coastal'
import { collectPeriods } from './collect-periods'
import { assert } from './utilities/assert'
import { quantileTypeSeven } from './utilities/quantile-type-seven'
import { divisors } from './utilities/divisors'
import { isNearInteger } from './utilities/is-near-integer'
import { isNonNegativeInteger } from './utilities/is-non-negative-integer'
import { isPositiveInteger } from './utilities/is-positive-integer'
import { isPositiveIntegerArray } from './utilities/is-positive-integer-array'
import { median } from './utilities/median'
import { recentRegimeMedian } from './utilities/recent-regime-median'
import { sortNumericAscending } from './utilities/sort-numeric-ascending'

const DEFAULT_CANONICAL_BASES = [50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240] as const
const DEFAULT_MAX_DIVISOR = 6
const DEFAULT_MIN_DRAW = 10
const MIN_MAX_DIVISOR = 1
const MIN_MIN_DRAW = 5
const DEFAULT_SAMPLES = 90
const DEFAULT_WARMUP = 10
const MIN_SAMPLES = 30
const MIN_WARMUP = 0

function frequencyToPeriod(frequency: number): number {
  return 1000 / frequency
}

function closestBase(
  medianPeriod: number,
  canonicalBases: readonly number[],
  maxDivisor: number,
): number {
  // Build array of unique candidates: canonical bases + their integer divisors
  const candidates: number[] = []

  // Add canonical bases
  for (const base of canonicalBases) {
    candidates.push(base)
  }

  // Add integer divisors up to maxDivisor
  for (const base of canonicalBases) {
    for (let divisor = 2; divisor <= maxDivisor; divisor++) {
      const divisorFrequency = base / divisor
      if (isNearInteger(divisorFrequency) && !candidates.includes(divisorFrequency)) {
        candidates.push(divisorFrequency)
      }
    }
  }

  // Find candidate with closest period distance
  let closestCandidate = candidates[0]
  let closestDistance = Math.abs(medianPeriod - frequencyToPeriod(closestCandidate))

  for (const candidate of candidates) {
    const candidatePeriod = frequencyToPeriod(candidate)
    const distance = Math.abs(medianPeriod - candidatePeriod)

    if (distance < closestDistance) {
      closestCandidate = candidate
      closestDistance = distance
    } else if (Math.abs(distance - closestDistance) <= 1e-12) {
      // Tie-break: choose lower frequency (longer period)
      if (candidatePeriod > frequencyToPeriod(closestCandidate)) {
        closestCandidate = candidate
      }
    }
  }

  return closestCandidate
}

export const recommendDrawRates = async (
  options: Required<SnaprollDrawRateAdvisorOptions>,
  onCancel: (cancelCallback: () => unknown) => void,
): Promise<SnaprollDrawRateAdvisorResponse | undefined> => {
  const { canonicalBases, maxDivisor, minDraw } = options
  const periods = await collectPeriods(options, onCancel)

  if (periods.length === 0) {
    return
  }

  const sortedPeriods = sortNumericAscending(periods)
  const medianPeriods = median(sortedPeriods)

  if (medianPeriods === undefined) {
    return
  }

  // Calculate median period (L1 estimation with recent regime prioritization)
  const recentRegimeMedianPeriod = recentRegimeMedian(periods) ?? medianPeriods

  // Detect severe throttling
  const inferredFrequency = 1000 / recentRegimeMedianPeriod
  if (inferredFrequency < minDraw) {
    // No meaningful draw rates can be recommended in severely throttled state
    return
  }

  // Find closest base (canonical or integer divisor) in period space
  const effectiveBase = closestBase(recentRegimeMedianPeriod, canonicalBases, maxDivisor)

  // Generate divisors with filtering and post-processing
  const values = divisors(effectiveBase, maxDivisor, minDraw)

  if (values.length === 0) {
    return
  }

  // Robustness: tightness of the whole distribution via relative IQR
  const firstQuartileAll = quantileTypeSeven(sortedPeriods, 0.25)
  const thirdQuartileAll = quantileTypeSeven(sortedPeriods, 0.75)
  const interquartileRangeAll = Math.max(0, thirdQuartileAll - firstQuartileAll)
  const robustnessFactor = medianPeriods / (medianPeriods + interquartileRangeAll)

  // Fit: center alignment to the snapped grid, normalized by overall median
  const effectiveBasePeriod = frequencyToPeriod(effectiveBase)
  const relativeCenterDeviation =
    medianPeriods > 0 ? Math.abs(recentRegimeMedianPeriod - effectiveBasePeriod) / medianPeriods : 1
  const fitFactor = 1 / (1 + relativeCenterDeviation)

  // Geometric mean keeps the score in [0,1] and penalizes weak factors smoothly
  const score = Math.sqrt(robustnessFactor * fitFactor)

  return { score, values }
}

export interface SnaprollDrawRateAdvisorResponse {
  /**
   * Quality score in range [0,1] using RF (Robustness × Fit) formula.
   * Higher scores indicate better data consistency and more reliable recommendations.
   *
   * Score interpretation:
   * - `0.95–1.00`: Rock-solid. Extremely stable capture, fits a canonical/divisor cleanly
   * - `0.85–0.95`: Healthy. Mild jitter only; values are trustworthy
   * - `0.75–0.85`: Borderline steady. Noticeable instability or light regime mixing; fine for most uses, re-run if chasing perfection
   * - `0.60–0.75`: Shaky. Significant jitter or likely mid-phase change; consider re-running
   * - `< 0.60`   : Unstable. Strong evidence of blocking/jitter or regime split; re-run recommended
   */
  score: number
  /**
   * Array of recommended draw rates (Hz), sorted descending and de-duplicated.
   * All values are integers and ≥ minDraw.
   */
  values: number[]
}

/**
 * Callback function invoked when draw rate estimation completes.
 *
 * @param response - The recommendation result containing draw rates and score
 */
export type SnaprollDrawRateAdvisorSubscription = (
  response: SnaprollDrawRateAdvisorResponse,
) => void

export interface SnaprollDrawRateAdvisorOptions {
  /**
   * Array of canonical refresh rates to consider for snapping.
   * Must be non-empty array of positive integers.
   * @defaultValue `[50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240]`
   */
  canonicalBases?: readonly number[]
  /**
   * Maximum count of divisors to consider for candidate generation and output.
   * Must be positive integer ≥ 1.
   * @defaultValue `6`
   */
  maxDivisor?: number
  /**
   * Minimum draw rate to include in results.
   * Must be positive integer ≥ 5.
   * @defaultValue `10`
   */
  minDraw?: number
  /**
   * Number of frame intervals to collect after warmup.
   * Must be positive integer ≥ 30.
   * @defaultValue `90`
   */
  samples?: number
  /**
   * Number of frames to ignore before sampling.
   * Must be non-negative integer ≥ 0.
   * @defaultValue `10`
   */
  warmup?: number
}

export const createSnaprollDrawRateAdvisorOptions = (
  options: SnaprollDrawRateAdvisorOptions,
): Required<SnaprollDrawRateAdvisorOptions> => {
  const canonicalBases = options.canonicalBases ?? DEFAULT_CANONICAL_BASES
  const maxDivisor = options.maxDivisor ?? DEFAULT_MAX_DIVISOR
  const minDraw = options.minDraw ?? DEFAULT_MIN_DRAW
  const samples = options.samples ?? DEFAULT_SAMPLES
  const warmup = options.warmup ?? DEFAULT_WARMUP

  assert(
    isPositiveInteger(maxDivisor),
    `maxDivisor must be a positive integer ≥ ${MIN_MAX_DIVISOR}`,
  )
  assert(
    isPositiveInteger(minDraw) && minDraw >= MIN_MIN_DRAW,
    `minDraw must be a positive integer ≥ ${MIN_MIN_DRAW}`,
  )
  assert(
    isPositiveIntegerArray(canonicalBases),
    `canonicalBases must be a non-empty array of positive integers`,
  )

  assert(
    isPositiveInteger(samples) && samples >= MIN_SAMPLES,
    `samples must be a positive integer ≥ ${MIN_SAMPLES}`,
  )
  assert(isNonNegativeInteger(warmup), `warmup must be a non-negative integer ≥ ${MIN_WARMUP}`)

  return {
    canonicalBases,
    maxDivisor,
    minDraw,
    samples,
    warmup,
  }
}

/**
 * Provides draw rates inferred from observed frame periods.
 *
 * The recommendation logic is stateless and deterministic: identical period inputs
 * produce identical outputs. Concurrent class instances do not interfere with each other.
 */
export class SnaprollDrawRateAdvisor {
  private readonly options: Required<SnaprollDrawRateAdvisorOptions>
  private promise: WithPromise<SnaprollDrawRateAdvisorResponse | undefined> | undefined = undefined
  private readonly subscriptions: SnaprollDrawRateAdvisorSubscription[] = []

  /**
   * Creates a new draw rate advisor instance.
   *
   * @param options - Configuration options for the advisor
   * @throws Assertion error if any option values are invalid
   */
  constructor(options: SnaprollDrawRateAdvisorOptions = {}) {
    this.options = createSnaprollDrawRateAdvisorOptions(options)
  }

  /**
   * Cancels ongoing operations and releases resources.
   */
  dispose() {
    if (this.promise?.state === 'pending') {
      void this.promise.cancel()
    }
  }

  /**
   * Cancels any previous ongoing operation before starting a new one.
   * Results are delivered to registered subscriptions when the operation completes.
   * If the operation is canceled or produces no recommendations, subscriptions are not invoked.
   */
  trigger() {
    const options = this.options

    if (this.promise?.state === 'pending') {
      void this.promise.cancel()
    }

    this.promise = withPromise(options, recommendDrawRates)

    void this.promise.then((result) => {
      if (result.state !== 'fulfilled' || result.value === undefined) {
        return
      }

      const value = result.value
      const subscriptions = this.subscriptions

      // eslint-disable-next-line typescript/prefer-for-of
      for (let index = 0; index < subscriptions.length; index++) {
        subscriptions[index](value)
      }
    })
  }

  /**
   * Registers callback for recommendation results.
   *
   * Callbacks receive SnaprollDrawRateAdvisorResponse when recommendation completes successfully.
   * Callbacks are not invoked if the operation is canceled or produces no recommendations.
   *
   * @param subscription - Callback function to invoke with results
   * @returns Function that unregisters the subscription when called
   */
  subscribe(subscription: SnaprollDrawRateAdvisorSubscription) {
    if (!this.subscriptions.includes(subscription)) {
      this.subscriptions.push(subscription)
    }

    return () => {
      remove(this.subscriptions, (value) => value === subscription)
    }
  }
}
