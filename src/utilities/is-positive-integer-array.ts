import { isPositiveInteger } from './is-positive-integer'

export const isPositiveIntegerArray = (input: unknown): input is number[] =>
  Array.isArray(input) && input.length > 0 && input.every(isPositiveInteger)
