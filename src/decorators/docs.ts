import 'reflect-metadata';
import type { Ctor } from '../types';

export const DOCS = Symbol.for('grain:docs');

export interface RouteDocs {
  summary?: string;
  tags?: string[];
}

export function Docs(meta: RouteDocs): ClassDecorator & MethodDecorator {
  return (target: Ctor | object, propertyKey?: string | symbol) => {
    if (propertyKey === undefined) {
      Reflect.defineMetadata(DOCS, meta, target as Ctor);
    } else {
      Reflect.defineMetadata(
        DOCS,
        meta,
        (target as object).constructor,
        propertyKey
      );
    }
  };
}
