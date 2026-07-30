import { expect, test } from 'bun:test';
import { Type as t } from '@sinclair/typebox';
import { Dto, dtoSchema } from '../src/validation/dto';

const Shape = t.Object({ name: t.String(), count: t.Number() });

class ShapeDto extends Dto(Shape) {}

test('a Dto subclass carries the original schema object', () => {
  expect(dtoSchema(ShapeDto)).toBe(Shape);
});

test('dtoSchema is null for non-Dto values', () => {
  class Plain {}
  expect(dtoSchema(Plain)).toBeNull();
  expect(dtoSchema(undefined)).toBeNull();
  expect(dtoSchema(Object)).toBeNull();
  expect(dtoSchema(Number)).toBeNull();
  expect(dtoSchema({})).toBeNull();
});

test('the instance type is the schema static type (compile-time check)', () => {
  // Typing vehicle only — never instantiated at runtime. This function is
  // dead code that exists so tsc verifies the declared instance type.
  const acceptsStatic = (value: ShapeDto): { name: string; count: number } =>
    value;
  expect(typeof acceptsStatic).toBe('function');
});
