const DEFAULT_EPSILON = 1e-10

export function isApproximatelyEqual(a: number, b: number, epsilon = DEFAULT_EPSILON): boolean {
  return Math.abs(a - b) <= epsilon
}
