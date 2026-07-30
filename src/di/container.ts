import 'reflect-metadata';
import type { Ctor } from '../types';
import type { Provider } from './provider';
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
  private readonly factories = new Map<Ctor, (c: Container) => unknown>();
  private readonly resolving = new Set<Ctor>();

  register(provider: Provider): void {
    if (typeof provider === 'function') return; // plain class: resolvable on demand
    if ('useValue' in provider) {
      this.instances.set(provider.provide, provider.useValue);
    } else if ('useClass' in provider) {
      this.factories.set(provider.provide, (c) => c.resolve(provider.useClass));
    } else {
      this.factories.set(provider.provide, provider.useFactory);
    }
  }

  resolve<T>(target: Ctor<T>): T {
    if (this.instances.has(target)) return this.instances.get(target) as T;
    const factory = this.factories.get(target);
    if (factory) {
      const instance = factory(this);
      this.instances.set(target, instance);
      return instance as T;
    }
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
