import 'reflect-metadata';
import type { Ctor } from '../types';
import { isInjectable } from './injectable';

const NON_INJECTABLE = new Set<unknown>([
  String,
  Number,
  Boolean,
  Object,
  Array,
  Function,
  Symbol,
]);

export class Container {
  private readonly instances = new Map<Ctor, unknown>();
  private readonly resolving = new Set<Ctor>();

  resolve<T>(target: Ctor<T>): T {
    if (this.instances.has(target)) return this.instances.get(target) as T;
    if (!isInjectable(target)) {
      throw new Error(
        `Cannot resolve ${target.name}: class is not marked with @Injectable() or @Controller()`
      );
    }
    if (this.resolving.has(target)) {
      const chain = [...this.resolving, target].map((c) => c.name).join(' → ');
      throw new Error(`Circular dependency detected: ${chain}`);
    }
    this.resolving.add(target);
    try {
      const paramTypes: unknown[] =
        Reflect.getMetadata('design:paramtypes', target) ?? [];
      const args = paramTypes.map((param, index) => {
        if (
          typeof param !== 'function' ||
          NON_INJECTABLE.has(param) ||
          param === undefined
        ) {
          throw new Error(
            `Cannot inject parameter ${index} of ${target.name}: not a class ` +
              `(primitives and interfaces are not injectable; ` +
              `an undefined type can also mean a circular file import)`
          );
        }
        return this.resolve(param as Ctor);
      });
      const instance = new target(...args);
      this.instances.set(target, instance);
      return instance;
    } finally {
      this.resolving.delete(target);
    }
  }
}
