import 'reflect-metadata';

export const DOCS = Symbol.for('grain:docs');

export interface RouteDocs {
  summary?: string;
  tags?: string[];
}

export function Docs(meta: RouteDocs): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(DOCS, meta, target.constructor, propertyKey);
  };
}
