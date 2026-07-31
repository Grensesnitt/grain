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
  const meta: ReturnsMeta =
    typeof codeOrSchema === 'number'
      ? { code: codeOrSchema, schema: maybeSchema! }
      : { schema: codeOrSchema };
  return (target, propertyKey) => {
    Reflect.defineMetadata(RETURNS, meta, target.constructor, propertyKey);
  };
}
