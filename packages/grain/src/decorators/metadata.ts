import 'reflect-metadata';
import type { TSchema } from '@sinclair/typebox';
import type { Ctor, Guard, HttpMethod } from '../types';

export const CONTROLLER_PREFIX = Symbol.for('grain:controller-prefix');
export const ROUTES = Symbol.for('grain:routes');
export const PARAMS = Symbol.for('grain:params');
export const HTTP_CODE = Symbol.for('grain:http-code');
export const GUARDS = Symbol.for('grain:guards');

export interface RouteSchemas {
  body?: TSchema;
  query?: TSchema;
  params?: TSchema;
}

export interface RawRoute {
  method: HttpMethod;
  path: string;
  handlerName: string;
  schemas: RouteSchemas;
}

export interface ParamMeta {
  index: number;
  kind: 'body' | 'param' | 'query' | 'ctx';
  name?: string;
}

export interface ResolvedRoute extends RawRoute {
  httpCode?: number;
  params: ParamMeta[];
  guards: Ctor<Guard>[];
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
  const routes = raw.map((route) => {
    const params: ParamMeta[] =
      Reflect.getMetadata(PARAMS, ctor, route.handlerName) ?? [];
    const methodGuards: Ctor<Guard>[] =
      Reflect.getMetadata(GUARDS, ctor, route.handlerName) ?? [];
    return {
      ...route,
      path: joinPath(prefix, route.path),
      httpCode: Reflect.getMetadata(HTTP_CODE, ctor, route.handlerName),
      params: [...params].sort((a, b) => a.index - b.index),
      guards: [...classGuards, ...methodGuards],
    };
  });
  return { prefix: joinPath(prefix, ''), routes };
}
