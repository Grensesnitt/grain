import type { Ctor } from '../types';
import type { Container } from './container';

// Tokens may be abstract classes (interface-style DI ports); only useClass
// targets must be instantiable.
export type ProviderToken<T = unknown> = abstract new (...args: any[]) => T;

export type Provider =
  | Ctor
  | { provide: ProviderToken; useValue: unknown }
  | { provide: ProviderToken; useClass: Ctor }
  | { provide: ProviderToken; useFactory: (container: Container) => unknown };
