import { Grain, type GrainOptions } from '../grain';
import { Logger } from '../logging/logger';
import type { Provider } from '../di/provider';

export interface TestAppOverrides {
  /**
   * Appended after the app's own providers — registration is last-wins, so
   * these replace same-token providers regardless of provider kind.
   */
  providers?: Provider[];
  /** Replaces the env source Config classes validate against. */
  env?: Record<string, string | undefined>;
  logger?: Logger;
}

// Builds a Grain app from existing options plus test overrides: swap any
// provider (service fakes, configs, ...) without rebuilding the options
// object. Defaults to a quiet logger (level 'error') so request logs stay out
// of test output.
export function createTestApp(
  options: GrainOptions,
  overrides: TestAppOverrides = {}
): Grain {
  return new Grain({
    ...options,
    env: overrides.env ?? options.env,
    logger:
      overrides.logger ?? options.logger ?? new Logger({ level: 'error' }),
    providers: [...(options.providers ?? []), ...(overrides.providers ?? [])],
  });
}
