export const isPositiveInteger = (input: unknown): input is number =>
  typeof input === 'number' && Number.isInteger(input) && input > 0
