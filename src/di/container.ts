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

export class WiringError extends Error {
  constructor(readonly issues: string[]) {
    super(`DI wiring failed:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'WiringError';
  }
}

// Diagnoses one constructor-param slot. `Object` gets its own case because it
// is what design:paramtypes collapses to when a param class is imported with
// `import type` — the single most common DI mistake.
function paramIssue(
  target: Ctor,
  index: number,
  param: unknown
): string | null {
  if (param === undefined) {
    return `${target.name} parameter ${index}: type is undefined — usually a circular file import`;
  }
  if (param === Object) {
    return (
      `${target.name} parameter ${index}: type collapsed to Object — the ` +
      `param class was probably imported with 'import type'; constructor-param ` +
      `classes need value imports`
    );
  }
  if (typeof param !== 'function' || NON_INJECTABLE.has(param)) {
    return `${target.name} parameter ${index}: primitives and interfaces are not injectable`;
  }
  return null;
}

export class Container {
  private readonly instances = new Map<Ctor, unknown>();
  private readonly factories = new Map<Ctor, (c: Container) => unknown>();
  private readonly resolving = new Set<Ctor>();
  private readonly classLinks = new Map<Ctor, Ctor>();
  private readonly registeredClasses: Ctor[] = [];
  private preflightDone = false;
  readonly configIssues: ConfigIssue[] = [];
  readonly wiringIssues: string[] = [];

  constructor(
    private readonly env: Record<string, string | undefined> = process.env
  ) {}

  register(provider: Provider): void {
    if (typeof provider === 'function') {
      // Plain classes are instantiated eagerly at init() so their lifecycle
      // hooks run even when nothing injects them (e.g. background workers).
      this.registeredClasses.push(provider);
      return;
    }
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
  // instantiating anything, collecting every problem the graph holds —
  // config-class validation issues (configIssues) and DI wiring mistakes
  // (wiringIssues: import-type collapse, circular-import undefined types,
  // primitives, missing @Injectable) — so boot fails once with the complete
  // list, before any constructor runs. useFactory providers are opaque to
  // the walk; anything they demand later hits the fallback paths in
  // resolve() instead.
  preflight(roots: Ctor[]): void {
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
      if (!isInjectable(target)) {
        this.wiringIssues.push(
          `${target.name} is not marked with @Injectable() or @Controller()`
        );
        return;
      }
      const paramTypes: unknown[] =
        Reflect.getMetadata('design:paramtypes', target) ?? [];
      paramTypes.forEach((param, index) => {
        const issue = paramIssue(target, index, param);
        if (issue) {
          this.wiringIssues.push(issue);
          return;
        }
        visit(param as Ctor);
      });
    };
    for (const root of roots) visit(root);
    this.preflightDone = true;
  }

  // Every provider token that init() must resolve eagerly.
  eagerTokens(): Ctor[] {
    return [...this.registeredClasses, ...this.factories.keys()];
  }

  // All distinct instances the container holds, in creation order
  // (dependencies precede their dependents; useValue instances come first).
  lifecycleInstances(): unknown[] {
    return [...new Set(this.instances.values())];
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
        const issue = paramIssue(target, index, param);
        if (issue) throw new WiringError([issue]);
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
