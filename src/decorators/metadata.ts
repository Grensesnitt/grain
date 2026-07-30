import 'reflect-metadata';
import { Type, type TSchema } from '@sinclair/typebox';
import type { Ctor, Guard, HttpMethod } from '../types';
import { dtoSchema } from '../validation/dto';

export const CONTROLLER_PREFIX = Symbol.for('grain:controller-prefix');
export const ROUTES = Symbol.for('grain:routes');
export const PARAMS = Symbol.for('grain:params');
export const HTTP_CODE = Symbol.for('grain:http-code');
export const GUARDS = Symbol.for('grain:guards');
export const PUBLIC = Symbol.for('grain:public');

export interface RouteSchemas {
  body?: TSchema;
  query?: TSchema;
  params?: TSchema;
}

export interface RawRoute {
  method: HttpMethod;
  path: string;
  handlerName: string;
}

export interface ParamMeta {
  index: number;
  kind: 'body' | 'param' | 'query' | 'ctx';
  name?: string;
}

export interface ResolvedRoute extends RawRoute {
  httpCode?: number;
  params: ParamMeta[];
  schemas: RouteSchemas;
  guards: Ctor<Guard>[];
  isPublic: boolean;
}

function primitiveSchema(type: unknown): TSchema | null {
  if (type === Number) return Type.Number();
  if (type === Boolean) return Type.Boolean();
  return null;
}

// Derives at most one schema per slot from the handler signature:
// Dto classes carry whole-slot schemas (and win over named contributions);
// named number/boolean params compose into a coercing object schema —
// required for path params (a matched route guarantees the segment),
// optional for query (queries are inherently optional).
export function deriveSchemas(
  params: ParamMeta[],
  paramTypes: unknown[],
  route: { path: string; context: string }
): RouteSchemas {
  const named: Record<'param' | 'query', Record<string, TSchema>> = {
    param: {},
    query: {},
  };
  const whole: Partial<Record<'param' | 'query', TSchema>> = {};
  const schemas: RouteSchemas = {};

  for (const meta of params) {
    if (meta.kind === 'ctx') continue;
    if (paramTypes.length > 0 && paramTypes[meta.index] === undefined) {
      throw new Error(
        `Cannot derive validation for ${route.context}: parameter ${meta.index} ` +
          `has type undefined (an undefined parameter type usually means a ` +
          `circular file import)`
      );
    }
    const type = paramTypes[meta.index];
    if (meta.kind === 'body') {
      const schema = dtoSchema(type);
      if (schema) schemas.body = schema;
    } else if (meta.kind === 'param' || meta.kind === 'query') {
      if (meta.name === undefined) {
        const schema = dtoSchema(type);
        if (schema) whole[meta.kind] = schema;
      } else {
        const primitive = primitiveSchema(type);
        if (primitive) {
          named[meta.kind][meta.name] =
            meta.kind === 'query' ? Type.Optional(primitive) : primitive;
        }
      }
    }
  }

  schemas.params =
    whole.param ??
    (Object.keys(named.param).length ? Type.Object(named.param) : undefined);
  schemas.query =
    whole.query ??
    (Object.keys(named.query).length ? Type.Object(named.query) : undefined);

  const pathParamNames = new Set(
    route.path
      .split('/')
      .filter((segment) => segment.startsWith(':'))
      .map((segment) => segment.slice(1))
  );
  for (const name of Object.keys(named.param)) {
    if (!pathParamNames.has(name)) {
      throw new Error(
        `Cannot derive validation for ${route.context}: @Param('${name}') has no ` +
          `matching :${name} segment in route path '${route.path}'`
      );
    }
  }

  return schemas;
}

export function joinPath(prefix: string, path: string): string {
  const joined = `/${prefix}/${path}`.replaceAll(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

export function readControllerMeta(ctor: Ctor): {
  prefix: string;
  routes: ResolvedRoute[];
} {
  const prefix: string = Reflect.getMetadata(CONTROLLER_PREFIX, ctor) ?? '/';
  const raw: RawRoute[] = Reflect.getMetadata(ROUTES, ctor) ?? [];
  const classGuards: Ctor<Guard>[] = Reflect.getMetadata(GUARDS, ctor) ?? [];
  const classPublic = Reflect.getOwnMetadata(PUBLIC, ctor) === true;
  const routes = raw.map((route) => {
    const params: ParamMeta[] =
      Reflect.getMetadata(PARAMS, ctor, route.handlerName) ?? [];
    const sortedParams = [...params].sort((a, b) => a.index - b.index);
    const methodGuards: Ctor<Guard>[] =
      Reflect.getMetadata(GUARDS, ctor, route.handlerName) ?? [];
    const paramTypes: unknown[] =
      Reflect.getMetadata(
        'design:paramtypes',
        ctor.prototype,
        route.handlerName
      ) ?? [];
    const path = joinPath(prefix, route.path);
    return {
      ...route,
      path,
      httpCode: Reflect.getMetadata(HTTP_CODE, ctor, route.handlerName),
      params: sortedParams,
      schemas: deriveSchemas(sortedParams, paramTypes, {
        path,
        context: `${ctor.name}.${route.handlerName}`,
      }),
      guards: [...classGuards, ...methodGuards],
      isPublic:
        classPublic ||
        Reflect.getOwnMetadata(PUBLIC, ctor, route.handlerName) === true,
    };
  });
  return { prefix: joinPath(prefix, ''), routes };
}
