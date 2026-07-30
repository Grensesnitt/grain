import type { Static, TSchema } from '@sinclair/typebox';

export const SCHEMA = Symbol.for('grain:dto-schema');

export type DtoClass<S extends TSchema = TSchema> =
  (abstract new () => Static<S>) & {
    readonly [SCHEMA]: S;
  };

// A typing vehicle: `class X extends Dto(schema) {}` gives X's instance type
// Static<typeof schema> and makes the schema reachable at boot through
// design:paramtypes. Dto classes are never instantiated — validated values
// stay plain objects.
export function Dto<S extends TSchema>(schema: S): DtoClass<S> {
  abstract class DtoBase {}
  Object.defineProperty(DtoBase, SCHEMA, { value: schema });
  return DtoBase as unknown as DtoClass<S>;
}

export function dtoSchema(target: unknown): TSchema | null {
  if (typeof target !== 'function') return null;
  const schema = (target as unknown as Record<PropertyKey, unknown>)[SCHEMA];
  return schema === undefined ? null : (schema as TSchema);
}
