import 'reflect-metadata';
import type { TSchema } from '@sinclair/typebox';
import { markInjectable } from '../di/injectable';
import type { Ctor } from '../types';

export const GATEWAY = Symbol.for('grain:gateway');

export interface GatewayMeta {
  path: string;
  message?: TSchema;
}

export function Gateway(
  path: string,
  options: { message?: TSchema } = {}
): ClassDecorator {
  return (target) => {
    markInjectable(target as unknown as Ctor);
    Reflect.defineMetadata(GATEWAY, { path, ...options }, target);
  };
}

export function readGatewayMeta(ctor: Ctor): GatewayMeta {
  const meta: GatewayMeta | undefined = Reflect.getMetadata(GATEWAY, ctor);
  if (!meta) throw new Error(`${ctor.name} is not marked with @Gateway()`);
  return meta;
}
