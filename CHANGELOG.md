# Changelog

Versions are git tags (`vX.Y.Z`); consumers pin them as
`github:Grensesnitt/grain#vX.Y.Z`. Breaking changes are marked **BREAKING**.

## v0.12.1 — 2026-09-01

- Abstract classes work as DI tokens (`ProviderToken`) for
  `useValue`/`useClass`/`useFactory` — interface-style ports like
  `abstract class EmailSender` with a swappable implementation.

## v0.12.0 — 2026-09-01

- `createTestApp(options, {providers?, env?, logger?})`: build an app with
  test overrides — swapped providers, synthetic env for config classes, quiet
  default logger.
- Container: re-registering a token is now last-wins across provider kinds
  (a `useClass` override after a `useValue` used to lose silently).

## v0.11.0 — 2026-09-01

- Lifecycle hooks: duck-typed `onModuleInit`/`onModuleDestroy` (interfaces
  exported), run dependencies-first / reverse order respectively.
- Registered plain-class providers are instantiated eagerly at init, so
  un-injected workers get lifecycle hooks (and preflight diagnostics).
- `app.shutdown()` (idempotent; hook errors logged, not rethrown) and
  `app.enableShutdownHooks()` (SIGTERM/SIGINT → shutdown → exit 0).
- **BREAKING**: `listen()` is async — `await app.listen(...)` — so async init
  hooks complete before the server accepts traffic.

## v0.10.0 — 2026-09-01

- Multi-status `@Returns`: stackable entries — one success contract, any
  number of documentation-only >= 400 entries; `@Returns(404)` without a
  schema documents the standard error envelope. Two success entries throw at
  boot (replaces the decoration-time duplicate error).

## v0.9.0 — 2026-09-01

- Structured logging: zero-dep `Logger` (JSON lines, levels, `child()`
  bindings, Error serialization, `pretty` mode, injectable sink), always
  registered as a DI provider (`GrainOptions.logger` or a default).
- Automatic request logs (`method/path/status/durationMs/requestId`, 4xx warn
  / 5xx error) with `x-request-id` propagation; WS error paths use the logger.

## v0.8.0 — 2026-09-01

- Boot-time DI diagnostics: the preflight walk collects every wiring mistake
  into one `WiringError` — `Object`-collapsed params (the `import type`
  gotcha, named with class + param index + fix), `undefined` types (circular
  imports), missing `@Injectable`. `resolve()` throws `WiringError` per slot
  as a fallback.

## v0.7.0 — 2026-09-01

- `createParamDecorator((ctx) => ...)`: custom param decorators
  (`@CurrentUser()`-style) built on ctx; custom slots are excluded from
  schema derivation.

## v0.6.1 — 2026-09-01

- Preflight config validation: all config issues aggregate BEFORE any
  constructor runs (an eager constructor could previously consume an invalid
  config value before the boot check).

## v0.6.0 — 2026-09-01

- Config injection: `Config(schema, {refine?})` classes validated from the
  environment when the DI graph demands them; aggregated `ConfigError` at
  boot; `resolveConfig()` for entrypoints; `GrainOptions.env` override;
  `useValue` providers bypass env validation for tests.

## v0.5.0 — 2026-07-31

- Class-level `@Docs` (merged with route-level, route wins per field).

## v0.4.0 — 2026-07-31

- `@Returns(schema)` / `@Returns(code, schema)` response contracts: success
  status, runtime `Value.Clean` of handler results (clone-first), OpenAPI
  responses. **BREAKING**: `RouteDocs.response` removed in favor of
  `@Returns`.

## v0.3.x — 2026-07-30/31

- v0.3.0: `@Docs` + OpenAPI generation with swagger-ui routes; WebSocket
  gateways (`@Gateway`, guard-checked upgrades, validated messages); built-in
  CORS; cookies; `onRequest`/`onError`/`onResponse` hooks; providers
  (`useValue`/`useClass`/`useFactory`); TypeBox schema defaults.
- v0.3.1/v0.3.2: hardening — WS lifecycle dispatch, CORS preflight gating,
  onResponse coverage for docs/preflight/upgrade paths, non-strict consumer
  typechecking.

## v0.0.1 — 2026-07-30

- Initial release: `Grain`, controllers and route decorators, handler param
  extraction, `Dto()` validation, DI container, guards and `@Public`,
  `@HttpCode`, error classes, route matcher compiled to `Bun.serve` routes.
