export function quantileTypeSeven(sortedValues: number[], probability: number): number {
  const length = sortedValues.length
  if (length === 0) return 0
  if (probability <= 0) return sortedValues[0]
  if (probability >= 1) return sortedValues[length - 1]

  const fractionalIndex = 1 + (length - 1) * probability
  const lowerIndexOneBased = Math.floor(fractionalIndex)
  const interpolationWeight = fractionalIndex - lowerIndexOneBased

  const lowerIndex = lowerIndexOneBased - 1
  const upperIndex = Math.min(lowerIndex + 1, length - 1)

  if (interpolationWeight === 0) {
    return sortedValues[lowerIndex]
  }

  const lowerValue = sortedValues[lowerIndex]
  const upperValue = sortedValues[upperIndex]
  return lowerValue + interpolationWeight * (upperValue - lowerValue)
}
