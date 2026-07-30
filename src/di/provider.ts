import type { Ctor } from '../types';
import type { Container } from './container';

export type Provider =
  | Ctor
  | { provide: Ctor; useValue: unknown }
  | { provide: Ctor; useClass: Ctor }
  | { provide: Ctor; useFactory: (container: Container) => unknown };
