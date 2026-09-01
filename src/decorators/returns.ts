import 'reflect-metadata';
import type { TSchema } from '@sinclair/typebox';

export const RETURNS = Symbol.for('grain:returns');

export interface ReturnsMeta {
  code?: number;
  schema?: TSchema;
}

// Stackable response contracts. At most one entry below status 400 (the
// success contract: sets the status, cleans the handler result, documents the
// body); any number of >= 400 entries are documentation-only — thrown
// HttpErrors produce those responses at runtime. An error entry without a
// schema documents grain's standard error envelope.
export function Returns(schema: TSchema): MethodDecorator;
export function Returns(code: number, schema?: TSchema): MethodDecorator;
export function Returns(
  codeOrSchema: number | TSchema,
  maybeSchema?: TSchema
): MethodDecorator {
  const meta: ReturnsMeta =
    typeof codeOrSchema === 'number'
      ? { code: codeOrSchema, schema: maybeSchema }
      : { schema: codeOrSchema };
  if (meta.code !== undefined && meta.code < 400 && meta.schema === undefined) {
    throw new Error(
      '@Returns(code) without a schema is only allowed for error codes ' +
        '(>= 400, documenting the standard error shape); success codes need ' +
        '@Returns(code, schema)'
    );
  }
  return (target, propertyKey) => {
    const list: ReturnsMeta[] =
      Reflect.getOwnMetadata(RETURNS, target.constructor, propertyKey!) ?? [];
    list.push(meta);
    Reflect.defineMetadata(RETURNS, list, target.constructor, propertyKey!);
  };
}
