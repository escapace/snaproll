/* eslint-disable typescript/strict-boolean-expressions */
/* eslint-disable tsdoc/syntax */

export function lerp(v0: number, v1: number, t: number) {
  return v0 * (1 - t) + v1 * t
}

export class MovingAverage {
  private readonly bucket: Array<{ ts: number; v: number }> = []
  private sum = 0

  constructor(public readonly intervalMs = 1000) {} // default = 1 s window

  /**  Add a new sample (timestamp in *ms* – use performance.now()).  */
  update(value: number, ts: number): void {
    this.bucket.push({ ts, v: value })
    this.sum += value
    this.prune(ts)
  }

  /**  Current average; returns 0 until we have at least one sample.   */
  value(): number {
    return this.bucket.length ? this.sum / this.bucket.length : 0
  }

  private prune(now: number): void {
    const ttl = this.intervalMs
    while (this.bucket.length && now - this.bucket[0].ts > ttl) {
      this.sum -= this.bucket.shift()!.v
    }
  }
}

/**
 * ---------------------------------------------------------------------------
 *  Frame-Time RMS Jitter – Practical Budgets
 * ---------------------------------------------------------------------------
 *
 * 1)  Cross-platform “rule-of-thumb” bands used by game engines,
 *     GPU vendors, and perceptual-motion studies
 *
 *     Refresh     GOLD          GOOD          MARGINAL      POOR / VISIBLE
 *     rate (T)    σ < 1 % T     1–3 % T       3–5 % T       σ > 5 % T
 *     --------------------------------------------------------------------
 *     60 Hz       ≤ 0.17 ms     0.17–0.50 ms  0.50–0.85 ms  > 0.85 ms
 *     90 Hz       ≤ 0.11 ms     0.11–0.33 ms  0.33–0.55 ms  > 0.55 ms
 *     120 Hz      ≤ 0.08 ms     0.08–0.25 ms  0.25–0.42 ms  > 0.42 ms
 *
 *     •  “Gold”   – virtually invisible micro-stutter.  Achievable with
 *        waitable swap-chains, Swappy, or VRR panels.
 *     •  “Good”   – considered smooth in QA for most genres.
 *     •  “Marginal” – shimmer visible in slow pans; often flagged for polish.
 *     •  “Poor”   – obvious stutter; must be fixed before ship.
 *
 *     (T = 1000 ms / refresh-rate; σ = RMS standard deviation of successive
 *      frame intervals Δt = tᵢ − tᵢ₋₁.)
 *
 * ---------------------------------------------------------------------------
 * 2)  What modern browsers typically deliver in a *visible* tab
 *
 *     Metric @60 Hz             Chrome 118+   Firefox 119+  Safari 17
 *     --------------------------------------------------------------------
 *     RMS frame-time jitter     0.10–0.25 ms  0.15–0.35 ms  0.20–0.45 ms
 *     Timer resolution (fg)    0.05 ms       0.10 ms       1 ms
 *     Long-Animation-Frame      > 50 ms flag  (same)       (same)
 *
 *     • Browsers already stay inside the “GOOD” band (< 0.50 ms) when the
 *       page is foreground and idle.  Larger σ almost always comes from
 *       page code: heavy JS, GC pauses, layout thrash, or big GPU frames.
 *     • DevTools throttling, background-tab throttling, or an initial
 *       startup interval > 100 ms can inflate the first sample—skip that
 *       when feeding the accumulator.
 *
 * ---------------------------------------------------------------------------
 *  TL;DR
 *  - Target σ ≤ 0.20 ms for “gold” pacing on a 60 Hz screen.
 *  - Browsers idle at ≈ 0.3 ms RMS; anything above that is on your side.
 *  - Use the table to classify the `rms` output of RmsIntervalJitter.
 * ---------------------------------------------------------------------------
 */
export class RmsIntervalJitter {
  private readonly intervals: Array<{ dt: number; time: number }> = []
  private sumDt = 0
  private sumDtSq = 0

  constructor(private readonly sampleInterval = 1000) {} // time window in ms

  /** Add one raw inter-frame interval, in milliseconds. */
  update(frameIntervalMs: number, currentTime: number = performance.now()): void {
    // Add new sample
    this.intervals.push({ dt: frameIntervalMs, time: currentTime })
    this.sumDt += frameIntervalMs
    this.sumDtSq += frameIntervalMs * frameIntervalMs

    this.purgeOldSamples(currentTime)
  }

  /** Purge outdated samples */
  private purgeOldSamples(currentTime: number): void {
    const cutoff = currentTime - this.sampleInterval
    while (this.intervals.length > 0 && this.intervals[0].time < cutoff) {
      const expired = this.intervals.shift()!
      this.sumDt -= expired.dt
      this.sumDtSq -= expired.dt * expired.dt
    }
  }

  /** RMS(Δt − μ) — standard deviation of frame times, in ms. */
  value(currentTime: number = performance.now()): number {
    this.purgeOldSamples(currentTime)

    const n = this.intervals.length
    if (n === 0) return 0

    const meanDt = this.sumDt / n
    const meanDtSq = this.sumDtSq / n
    const variance = meanDtSq - meanDt * meanDt

    return Math.sqrt(Math.max(variance, 0))
  }
}

export class FrequencyEstimation {
  private count = 0
  private last = 0
  private sum = 0

  constructor(private readonly sampleInterval = 1000) {}

  update(currentTime: number = performance.now(), update = true): void {
    if (update) {
      this.count++
    }

    if (currentTime - this.last >= this.sampleInterval) {
      const factor = 0.9
      this.sum = this.sum * (1 - factor) + this.count * factor
      this.count = 0
      this.last = currentTime
    }
  }

  value(): number {
    this.update(performance.now(), false)
    return this.sum
  }
}

/**
 * Computes the maximum perceptual motion speed in CSS pixels per millisecond
 * that is safely representable at a given frame rate, using both
 * signal sampling theory (Nyquist) and perceptual psychophysics.*
 *
 * @param drawRate - The display or animation frame rate in Hz (e.g., 60, 120)
 * @returns The upper bound of linear visual motion (in CSS pixels/millisecond) that
 *          can be rendered without perceptible strobing or motion artifacts.
 *
 * ## Rationale
 * The function combines two constraints on per-frame displacement:
 *
 * 1. **Nyquist Sampling Limit**:
 *    According to the Nyquist–Shannon sampling theorem, the maximum
 *    spatial frequency (or velocity in this case) that can be faithfully
 *    represented is half the sampling rate. In the context of motion,
 *    this means objects cannot move more than 0.5 degrees of visual angle
 *    per frame without risk of aliasing. At 60 Hz, this results in a
 *    velocity cap of:
 *
 *        60 Hz * 0.5 deg/frame = 30 deg/sec
 *
 *    This is the *physical sampling ceiling* — exceeding it means
 *    mathematically incorrect reconstruction is possible.
 *
 * 2. **Perceptual Displacement Limit**:
 *    Human visual perception can detect strobing and judder well
 *    before this hard Nyquist limit. Research suggests that per-frame
 *    displacements as low as 0.10–0.50 degrees may already be visually
 *    disruptive depending on content type, viewing conditions, and
 *    observer variability. A *nominal safe value* of **0.25 deg/frame**
 *    is widely cited in animation/UI literature as a perceptual comfort zone,
 *    particularly for content designed around smooth pursuit motion.
 *
 *    At 60 Hz:
 *
 *        60 Hz * 0.25 deg/frame = 15 deg/sec
 *
 *    This is the *psychophysical motion comfort ceiling*.
 *
 * This constant is derived from motion perception research
 * and practical animation guidance:
 *
 * - Smooth-pursuit accuracy degrades above ~0.25–0.33 °/frame at 60 fps
 * - Low-contrast or high-frequency stimuli (e.g. fine UI) require smaller displacements
 * - 0.25 strikes a reasonable compromise across devices and viewing setups
 * - It aligns with industry heuristics (Apple, Microsoft motion design specs)
 * - While not a hard limit, it avoids most perceptual artifacts without resorting to motion blur
 *
 * Practitioners may tune this up to ~0.50 or down to ~0.10 depending on content.
 */
function maxVelocityMagnitude(drawRate: number, perceptualAngle = 0.25): number {
  return Math.min(drawRate * 0.5, drawRate * perceptualAngle) / 0.0213 / 1000 // 1 CSS px ≈ 0.0213° of visual angle
}

export function decomposeVelocityMagnitude(
  options: {
    drawRate: number
    windowHeight: number
    windowWidth: number
    perceptualAngle?: number
  },
  previous?: { xSpeed?: number; ySpeed?: number },
): { xSpeed: number; ySpeed: number } {
  let angle: number

  const magnitudePixelsPerMs = maxVelocityMagnitude(options.drawRate, options.perceptualAngle)

  if (previous?.xSpeed === undefined || previous?.ySpeed === undefined) {
    // Random direction
    angle = Math.random() * 2 * Math.PI
  } else {
    // Convert previous speeds back to pixels to get angle
    const previousXPixels = (previous.xSpeed * options.windowWidth) / 100
    const previousYPixels = (previous.ySpeed * options.windowHeight) / 100
    angle = Math.atan2(previousYPixels, previousXPixels)
  }

  // Decompose magnitude in pixels
  const xSpeedPixelsPerMs = magnitudePixelsPerMs * Math.cos(angle)
  const ySpeedPixelsPerMs = magnitudePixelsPerMs * Math.sin(angle)

  // Convert to viewport units
  const xSpeedVwPerMs = (xSpeedPixelsPerMs * 100) / options.windowWidth
  const ySpeedVhPerMs = (ySpeedPixelsPerMs * 100) / options.windowHeight

  return {
    xSpeed: xSpeedVwPerMs,
    ySpeed: ySpeedVhPerMs,
  }
}
