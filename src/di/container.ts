import 'reflect-metadata';
import type { Ctor } from '../types';
import type { Provider } from './provider';
import { isInjectable } from './injectable';
import {
  ConfigError,
  configSchema,
  loadConfigValue,
  type ConfigIssue,
} from '../config/config';

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
  private readonly classLinks = new Map<Ctor, Ctor>();
  private preflightDone = false;
  readonly configIssues: ConfigIssue[] = [];

  constructor(
    private readonly env: Record<string, string | undefined> = process.env
  ) {}

  register(provider: Provider): void {
    if (typeof provider === 'function') return; // plain class: resolvable on demand
    if ('useValue' in provider) {
      this.instances.set(provider.provide, provider.useValue);
    } else if ('useClass' in provider) {
      this.factories.set(provider.provide, (c) => c.resolve(provider.useClass));
      this.classLinks.set(provider.provide, provider.useClass);
    } else {
      this.factories.set(provider.provide, provider.useFactory);
    }
  }

  // Walks design:paramtypes metadata from the given roots WITHOUT
  // instantiating anything, loading every reachable config class so all of
  // their validation issues aggregate into one boot failure — before any
  // dependent's constructor can run with an invalid config value. useFactory
  // providers are opaque to the walk; configs they demand later hit the
  // immediate-throw path in resolve() instead.
  preflightConfigs(roots: Ctor[]): void {
    const visited = new Set<Ctor>();
    const visit = (target: Ctor): void => {
      if (visited.has(target)) return;
      visited.add(target);
      if (this.instances.has(target)) return; // useValue: nothing to validate
      const link = this.classLinks.get(target);
      if (link) {
        visit(link);
        return;
      }
      if (this.factories.has(target)) return; // useFactory: opaque
      if (configSchema(target)) {
        this.resolve(target);
        return;
      }
      const paramTypes: unknown[] =
        Reflect.getMetadata('design:paramtypes', target) ?? [];
      for (const param of paramTypes) {
        if (typeof param === 'function' && !NON_INJECTABLE.has(param)) {
          visit(param as Ctor);
        }
      }
    };
    for (const root of roots) visit(root);
    this.preflightDone = true;
  }

  resolve<T>(target: Ctor<T>): T {
    if (this.instances.has(target)) return this.instances.get(target) as T;
    const factory = this.factories.get(target);
    if (factory) {
      const instance = factory(this);
      this.instances.set(target, instance);
      return instance as T;
    }
    // Config classes resolve to a value validated from the environment —
    // injecting one is what registers it. Validation issues are collected
    // (not thrown) so the boot pass can report every config class's problems
    // in a single failure. Explicit providers above still take precedence,
    // which is how tests substitute a config without touching the env.
    const schema = configSchema(target);
    if (schema) {
      const before = this.configIssues.length;
      const instance = loadConfigValue(
        target,
        schema,
        this.env,
        this.configIssues
      );
      // A config class first demanded after the preflight pass (e.g. from
      // inside a useFactory provider) missed the aggregated boot report, so
      // an invalid one must throw here — a dependent's constructor must
      // never run with an invalid config value.
      if (this.preflightDone && this.configIssues.length > before) {
        throw new ConfigError(this.configIssues.slice(before));
      }
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
