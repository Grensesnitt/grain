import type { TSchema } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { Value } from '@sinclair/typebox/value'
import { ValidationError } from '../errors/http-error'

export type Validator = (value: unknown) => unknown

export function compileValidator(
  schema: TSchema,
  source: 'body' | 'query' | 'params',
): Validator {
  const check = TypeCompiler.Compile(schema)
  const convert = source !== 'body'
  return (value) => {
    // Value.Convert mutates in place — clone so a failed validation never
    // leaks partially-coerced values back into the caller's object.
    const input = convert ? Value.Convert(schema, Value.Clone(value)) : value
    if (check.Check(input)) return input
    const details = [...check.Errors(input)].map((e) => ({
      path: e.path,
      message: e.message,
    }))
    throw new ValidationError(`${source} validation failed`, details)
  }
}
