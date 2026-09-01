import type { Static, TObject } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { Value } from '@sinclair/typebox/value';

export const CONFIG_SCHEMA = Symbol.for('grain:config-schema');
const CONFIG_REFINE = Symbol.for('grain:config-refine');

// Cross-field rules that a schema cannot express ("MANDRILL_API_KEY is
// required unless EMAIL_DISABLED"). Runs only after the schema itself
// validated; returned messages become ConfigIssues on the owning class.
export type ConfigRefine<S extends TObject = TObject> = (
  config: Static<S>
) => string[] | undefined | void;

export type ConfigClass<S extends TObject = TObject> =
  (abstract new () => Static<S>) & {
    readonly [CONFIG_SCHEMA]: S;
  };

export interface ConfigIssue {
  configName: string;
  path: string;
  message: string;
}

export class ConfigError extends Error {
  constructor(readonly issues: ConfigIssue[]) {
    const lines = issues.map(
      (i) => `  - ${i.configName}${i.path ? ` ${i.path}` : ''}: ${i.message}`
    );
    super(`Config validation failed:\n${lines.join('\n')}`);
    this.name = 'ConfigError';
  }
}

// A typing vehicle like Dto(): `class EmailConfig extends Config(schema) {}`
// gives the class an instance type of Static<typeof schema> and makes the
// schema reachable at boot. Config classes are never instantiated — the DI
// container builds their value by validating the environment when (and only
// when) something in the dependency graph injects them, so deleting the last
// consumer of a config class also deletes its env requirements.
export function Config<S extends TObject>(
  schema: S,
  options?: { refine?: ConfigRefine<S> }
): ConfigClass<S> {
  abstract class ConfigBase {}
  Object.defineProperty(ConfigBase, CONFIG_SCHEMA, { value: schema });
  if (options?.refine) {
    Object.defineProperty(ConfigBase, CONFIG_REFINE, { value: options.refine });
  }
  return ConfigBase as unknown as ConfigClass<S>;
}

export function configSchema(target: unknown): TObject | null {
  if (typeof target !== 'function') return null;
  const schema = (target as unknown as Record<PropertyKey, unknown>)[
    CONFIG_SCHEMA
  ];
  return schema === undefined ? null : (schema as TObject);
}

// Builds a config value from `env` against the class's schema. Only declared
// keys are read (an empty string counts as unset, matching env conventions),
// then values are coerced (Convert — env vars are always strings), defaults
// applied (Default) and the result checked. Errors are appended to `issues`
// rather than thrown, and the (possibly invalid) value is still returned, so
// a boot pass can collect the issues of every config class before failing.
export function loadConfigValue(
  target: { name: string },
  schema: TObject,
  env: Record<string, string | undefined>,
  issues: ConfigIssue[]
): unknown {
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(schema.properties ?? {})) {
    const value = env[key];
    if (value !== undefined && value !== '') raw[key] = value;
  }
  let input: unknown = Value.Convert(schema, raw);
  input = Value.Default(schema, input);
  const check = TypeCompiler.Compile(schema);
  if (!check.Check(input)) {
    // TypeBox reports a missing required property as two errors at the same
    // path ("Expected required property" + the type mismatch) — keep one
    // issue per env var.
    const seen = new Set<string>();
    for (const e of check.Errors(input)) {
      const path = e.path.replace(/^\//, '');
      if (seen.has(path)) continue;
      seen.add(path);
      issues.push({ configName: target.name, path, message: e.message });
    }
    return input;
  }
  const refine = (target as unknown as Record<PropertyKey, unknown>)[
    CONFIG_REFINE
  ] as ConfigRefine | undefined;
  const out = refine ? refine(input as Static<TObject>) : undefined;
  for (const message of Array.isArray(out) ? out : []) {
    issues.push({ configName: target.name, path: '', message });
  }
  return input;
}

// Standalone loader for use outside a DI graph (entrypoints, seed scripts):
// validates immediately and throws ConfigError on any issue.
export function resolveConfig<S extends TObject>(
  target: ConfigClass<S>,
  env: Record<string, string | undefined> = process.env
): Static<S> {
  const issues: ConfigIssue[] = [];
  const value = loadConfigValue(target, target[CONFIG_SCHEMA], env, issues);
  if (issues.length > 0) throw new ConfigError(issues);
  return value as Static<S>;
}
