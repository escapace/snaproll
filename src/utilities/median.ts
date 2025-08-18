export function median(sortedValues: number[]): number | undefined {
  if (sortedValues.length === 0) {
    return undefined
  }

  const mid = Math.floor(sortedValues.length / 2)

  return sortedValues.length % 2 === 0
    ? (sortedValues[mid - 1] + sortedValues[mid]) / 2
    : sortedValues[mid]
}
