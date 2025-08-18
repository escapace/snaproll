const isPositiveNumber = (input: unknown): input is number =>
  typeof input === 'number' && input > 0 && Number.isFinite(input)

const isUndefined = (input: unknown): input is undefined => input === undefined

export const isPositiveNumberOrUndefined = (input: unknown): input is number | undefined =>
  isPositiveNumber(input) || isUndefined(input)
