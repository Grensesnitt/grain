import { expect, test } from 'bun:test'
import { Type as t } from '@sinclair/typebox'
import { compileValidator } from '../src/validation/compile'
import { ValidationError } from '../src/errors/http-error'
import '../src/validation/formats'

const Body = t.Object({ name: t.String({ minLength: 1 }), age: t.Number() })
const Query = t.Object({ page: t.Number(), active: t.Optional(t.Boolean()) })

test('valid body passes through unchanged', () => {
  const validate = compileValidator(Body, 'body')
  expect(validate({ name: 'Runar', age: 40 })).toEqual({ name: 'Runar', age: 40 })
})

test('body is strict: string numbers are NOT coerced', () => {
  const validate = compileValidator(Body, 'body')
  expect(() => validate({ name: 'Runar', age: '40' })).toThrow(ValidationError)
})

test('query coerces strings to schema types', () => {
  const validate = compileValidator(Query, 'query')
  expect(validate({ page: '2', active: 'true' })).toEqual({ page: 2, active: true })
})

test('failure throws ValidationError with source in message and path details', () => {
  const validate = compileValidator(Body, 'body')
  try {
    validate({ name: '', age: 'x' })
    expect.unreachable()
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError)
    const ve = err as ValidationError
    expect(ve.statusCode).toBe(400)
    expect(ve.message).toBe('body validation failed')
    const details = ve.details as Array<{ path: string; message: string }>
    expect(details.length).toBeGreaterThanOrEqual(2)
    expect(details.map((d) => d.path)).toContain('/name')
    expect(details.map((d) => d.path)).toContain('/age')
    for (const d of details) expect(typeof d.message).toBe('string')
  }
})

test('params validator coerces too', () => {
  const validate = compileValidator(t.Object({ id: t.Number() }), 'params')
  expect(validate({ id: '42' })).toEqual({ id: 42 })
})

test('coercion never mutates the caller input object', () => {
  const validate = compileValidator(Query, 'query')
  const input = { page: '2', active: 'true' }
  const output = validate(input)
  expect(output).not.toBe(input)
  expect(input).toEqual({ page: '2', active: 'true' })
  const failing = { page: 'not-a-number' }
  expect(() => validate(failing)).toThrow(ValidationError)
  expect(failing).toEqual({ page: 'not-a-number' })
})

test('email format is registered so `format: "email"` schemas validate out of the box', () => {
  const validate = compileValidator(t.Object({ email: t.String({ format: 'email' }) }), 'body')
  expect(validate({ email: 'runar@grensesnitt.no' })).toEqual({ email: 'runar@grensesnitt.no' })
  expect(() => validate({ email: 'not-an-email' })).toThrow(ValidationError)
})
