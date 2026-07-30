import 'reflect-metadata';
import type { TSchema } from '@sinclair/typebox';

export const DOCS = Symbol.for('grain:docs');

export interface RouteDocs {
  summary?: string;
  tags?: string[];
  response?: TSchema | Record<number, TSchema>;
}

export function Docs(meta: RouteDocs): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(DOCS, meta, target.constructor, propertyKey);
  };
}
