export const isNearInteger = (value: number, epsilon = 1e-9): boolean =>
  Math.abs(value - Math.round(value)) <= epsilon
