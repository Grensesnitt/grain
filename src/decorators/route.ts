import 'reflect-metadata';
import type { HttpMethod } from '../types';
import { ROUTES, type RawRoute } from './metadata';

function createRouteDecorator(method: HttpMethod) {
  return (path = '/'): MethodDecorator =>
    (target, propertyKey) => {
      const ctor = target.constructor;
      const routes: RawRoute[] = Reflect.getMetadata(ROUTES, ctor) ?? [];
      routes.push({ method, path, handlerName: String(propertyKey) });
      Reflect.defineMetadata(ROUTES, routes, ctor);
    };
}

export const Get = createRouteDecorator('GET');
export const Post = createRouteDecorator('POST');
export const Put = createRouteDecorator('PUT');
export const Patch = createRouteDecorator('PATCH');
export const Delete = createRouteDecorator('DELETE');
