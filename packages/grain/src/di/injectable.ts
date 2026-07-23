import 'reflect-metadata';
import type { Ctor } from '../types';

const INJECTABLE = Symbol.for('grain:injectable');

export function markInjectable(target: Ctor): void {
  Reflect.defineMetadata(INJECTABLE, true, target);
}

export function isInjectable(target: Ctor): boolean {
  return Reflect.getOwnMetadata(INJECTABLE, target) === true;
}

export function Injectable(): ClassDecorator {
  return (target) => {
    // ClassDecorator's target is typed as the generic `Function`; at runtime
    // it is always the class constructor being decorated.
    markInjectable(target as unknown as Ctor);
  };
}
