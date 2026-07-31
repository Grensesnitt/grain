import 'reflect-metadata';
import type { TSchema } from '@sinclair/typebox';

export const RETURNS = Symbol.for('grain:returns');

export interface ReturnsMeta {
  code?: number;
  schema: TSchema;
}

export function Returns(schema: TSchema): MethodDecorator;
export function Returns(code: number, schema: TSchema): MethodDecorator;
export function Returns(
  codeOrSchema: number | TSchema,
  maybeSchema?: TSchema
): MethodDecorator {
  if (typeof codeOrSchema === 'number' && maybeSchema === undefined) {
    throw new Error('@Returns(code) requires a schema: @Returns(code, schema)');
  }
  const meta: ReturnsMeta =
    typeof codeOrSchema === 'number'
      ? { code: codeOrSchema, schema: maybeSchema! }
      : { schema: codeOrSchema };
  return (target, propertyKey) => {
    if (
      Reflect.getOwnMetadata(RETURNS, target.constructor, propertyKey!) !==
      undefined
    ) {
      throw new Error(
        `Duplicate @Returns on ${(target.constructor as { name: string }).name}.${String(propertyKey)}`
      );
    }
    Reflect.defineMetadata(RETURNS, meta, target.constructor, propertyKey);
  };
}
