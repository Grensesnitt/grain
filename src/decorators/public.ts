import 'reflect-metadata';
import type { Ctor } from '../types';
import { PUBLIC } from './metadata';

export function Public(): ClassDecorator & MethodDecorator {
  return (target: Ctor | object, propertyKey?: string | symbol) => {
    if (propertyKey === undefined) {
      Reflect.defineMetadata(PUBLIC, true, target as Ctor);
    } else {
      Reflect.defineMetadata(
        PUBLIC,
        true,
        (target as object).constructor,
        propertyKey
      );
    }
  };
}
