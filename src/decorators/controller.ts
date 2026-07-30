import 'reflect-metadata';
import { markInjectable } from '../di/injectable';
import { CONTROLLER_PREFIX } from './metadata';
import type { Ctor } from '../types';

export function Controller(prefix = '/'): ClassDecorator {
  return (target) => {
    // ClassDecorator's target is typed as the generic `Function`; at runtime
    // it is always the class constructor being decorated.
    markInjectable(target as unknown as Ctor);
    Reflect.defineMetadata(CONTROLLER_PREFIX, prefix, target);
  };
}
