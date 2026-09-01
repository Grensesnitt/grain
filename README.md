# grain

A NestJS-style web framework for [Bun](https://bun.sh): decorator-based
controllers, constructor injection, TypeBox validation, OpenAPI docs and
WebSocket gateways — compiled once at boot into plain `Bun.serve` route
closures. Two runtime dependencies (`@sinclair/typebox`, `reflect-metadata`),
no build step: consumers run the TypeScript source directly.

The philosophy: keep the NestJS conventions worth keeping (controllers,
providers, guards, DTOs, lifecycle hooks), drop the machinery that isn't
needed under Bun (`@Module`, interceptor/pipe/filter zoo, RxJS), and make boot
**fail fast and completely** — config validation, DI wiring problems and route
conflicts are all reported before the server accepts a request.

## Install

```sh
bun add github:Grensesnitt/grain#v0.12.0
```

Consumers need decorator metadata in their `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Requires Bun >= 1.3.14 (earlier versions have a scoped git-dependency cache
bug that breaks installing grain from its tag).

## Quick start

```ts
import {
  Config,
  Controller,
  Dto,
  Get,
  Grain,
  Injectable,
  NotFoundError,
  Post,
  Body,
  Param,
  Returns,
  resolveConfig,
  t,
} from '@grensesnitt/grain';

class AppConfig extends Config(
  t.Object({ PORT: t.Number({ default: 3000 }) })
) {}

export class NoteCreateDto extends Dto(
  t.Object(
    { text: t.String({ minLength: 1 }) },
    { additionalProperties: false }
  )
) {}

const NoteEnvelope = t.Object({ id: t.Number(), text: t.String() });

@Injectable()
class NotesService {
  private readonly notes: { id: number; text: string }[] = [];
  add(text: string) {
    const note = { id: this.notes.length + 1, text };
    this.notes.push(note);
    return note;
  }
  get(id: number) {
    return this.notes[id - 1] ?? null;
  }
}

@Controller('/notes')
class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post('/')
  @Returns(201, NoteEnvelope)
  create(@Body() body: NoteCreateDto) {
    return this.notes.add(body.text);
  }

  @Get('/:id')
  @Returns(NoteEnvelope)
  @Returns(404)
  read(@Param('id') id: number) {
    const note = this.notes.get(id);
    if (!note) throw new NotFoundError();
    return note;
  }
}

const config = resolveConfig(AppConfig);
const app = new Grain({
  controllers: [NotesController],
  docs: { path: '/docs', info: { title: 'Notes' } },
});
await app.listen(config.PORT); // listen() is async: onModuleInit hooks finish first
app.enableShutdownHooks();
```

`bun run app.ts` gives you validated requests, cleaned responses, structured
request logs, `/docs` with a generated OpenAPI document, and SIGTERM-safe
shutdown.

## Feature tour

### Routing and handler params

`@Controller(prefix)` + `@Get/@Post/@Put/@Patch/@Delete(path)`. Handler
params: `@Body()`, `@Param(name?)`, `@Query(name?)`, `@Ctx()`. Named
`@Param`/`@Query` params typed `number`/`boolean` get coercing validation
derived from the signature; `@Param('x')` without a matching `:x` segment
throws at boot.

### Validation — `Dto()`

`class X extends Dto(schema) {}` is a typing vehicle: the class's instance
type is `Static<typeof schema>` and the schema rides along for boot-time
compilation. Dto classes are never instantiated — validated values stay plain
objects. Bodies are checked as-is; params/query are coerced first (env-style
strings), defaults applied, then checked. Failures are 400s with per-path
details.

### Response contracts — `@Returns`

`@Returns(schema)` / `@Returns(code, schema)` sets the success status,
**runtime-cleans** the handler result against the schema (recursive
`Value.Clean`, clone-first — this is what keeps `password` out of responses),
and documents the response. Stackable since v0.10.0: add documentation-only
error entries, where `@Returns(404)` without a schema documents grain's
standard error envelope:

```ts
@Get('/:id')
@Returns(UserEnvelope)
@Returns(404)
@Returns(409, ConflictSchema)
```

### OpenAPI

`GrainOptions.docs` serves swagger-ui at `docs.path` and the document at
`${path}/json`, generated from routes, schemas, `@Docs({summary, tags})`
(class- or method-level) and `@Returns`. `securitySchemes`/`security`
supported; `@Public` routes emit `security: []`.

### Guards

`Guard` = `{ canActivate(ctx) }`. Global (`GrainOptions.guards`), class- or
method-level via `@UseGuard(...)`; `@Public()` opts a class or route out of
the global guards. Guards are DI-resolved and typically stash request values
on `ctx.store`.

### Config classes

```ts
export class EmailConfig extends Config(
  t.Object({
    EMAIL_DISABLED: t.Boolean({ default: false }),
    MANDRILL_API_KEY: t.Optional(t.String()),
  }),
  {
    refine: (c) =>
      c.EMAIL_DISABLED || c.MANDRILL_API_KEY
        ? []
        : ['MANDRILL_API_KEY is required unless EMAIL_DISABLED'],
  }
) {}
```

Constructor-inject it like any class. **Injecting a config class is what
registers it**: the container validates it against the environment (declared
keys only, empty string = unset, string coercion, defaults) when the
dependency graph demands it — delete a module and its env requirements go
with it. All config problems across all classes aggregate into one
`ConfigError` at boot, before any constructor runs. `refine` carries
cross-field rules. Outside the DI graph (entrypoints, scripts) use
`resolveConfig(ConfigClass)`; in tests, a `useValue` provider bypasses env
validation entirely. `GrainOptions.env` swaps the source (defaults to
`process.env`).

### Dependency injection

Constructor injection over `design:paramtypes`, class tokens only, singletons.
Providers: plain class, `{provide, useValue}`, `{provide, useClass}`,
`{provide, useFactory}`; re-registering a token is last-wins regardless of
provider kind. Registered plain classes are instantiated **eagerly** at init
so background workers run without being injected anywhere.

Boot walks the whole graph first and reports every wiring mistake as one
`WiringError` — including the classic: importing a constructor-param class
with `import type` collapses its metadata to `Object`, and grain names the
class, the parameter index and the fix.

### Lifecycle

`onModuleInit`/`onModuleDestroy` are duck-typed (any instance with the method
participates — framework-free packages included); interfaces `OnModuleInit`/
`OnModuleDestroy` exist for ergonomics. Init runs dependencies-first before
the first request (`await app.listen(...)` / `app.handle(...)` wait for it);
destroy runs in reverse order via `await app.shutdown()`.
`app.enableShutdownHooks()` wires SIGTERM/SIGINT → shutdown → exit 0.

### Logging

`GrainOptions.logger` (or a default) is always registered as a DI provider —
services inject `Logger`. JSON lines with levels, `child()` bindings, `Error`
serialization, `pretty` mode and an injectable `write` sink. Every response is
logged (`method/path/status/durationMs/requestId`; 4xx warn, 5xx error) and
`x-request-id` is propagated or generated, echoed on the response and stashed
at `ctx.store.requestId`.

### Custom param decorators

```ts
const CurrentUser = createParamDecorator((ctx) => ctx.store.user);
// ...
@Get('/') me(@CurrentUser() user: UserInterface) { ... }
```

Custom slots stay out of schema derivation, like `@Ctx()`.

### WebSockets

`@Gateway(path, {message?: schema})` on a class implementing
`WsGateway` (`open`/`message`/`close` with a `WsClient`). Upgrades are
guard-checked, messages JSON-parsed and schema-validated, errors answered with
the standard envelope.

### Hooks, CORS, cookies

App-level `onRequest` (may short-circuit with a `Response`), `onError`,
`onResponse` hooks. Built-in CORS (`GrainOptions.cors`) with preflight
handling; `'*'` + credentials is rejected. `ctx.cookies` / `ctx.setCookie()`
with cookies flushed after response hooks.

### Errors

`HttpError` subclasses (`BadRequestError`, `UnauthorizedError`,
`ForbiddenError`, `NotFoundError`, `ConflictError`, `ValidationError`)
serialize to `{statusCode, error, message, details?}`; anything else is a 500
(stack in `details` when `NODE_ENV=development`). Customize via an `onError`
hook returning a `Response`.

### Testing

`app.handle(new Request(...))` drives the full pipeline in-process — no
socket needed. `createTestApp(options, {providers?, env?, logger?})` builds an
app with overrides: swap any provider for a fake (last-wins), point config
classes at a synthetic env, and get a quiet logger by default.

## Gotchas

- **`await app.listen(...)`** — async since v0.11.0 so init hooks finish
  before traffic.
- **Value imports for DI param classes** — `import type` erases the runtime
  metadata; boot diagnoses it, but the fix is on you.
- **Config fields are env-var-named** — `config.PORT`, not `config.port`.
- Consumers own `experimentalDecorators`/`emitDecoratorMetadata`; grain does
  not patch your tsconfig.

## Example app

`apps/example/` is a runnable tour: controllers, DTOs, API-token and JWT
guards, a WebSocket gateway, docs and CORS wiring. `bench/` compares raw
`Bun.serve`, grain and Elysia (`bun run bench`).

## Development

`bun test && bun run check && bun run lint && bun run format:check` gates a
release; bump `package.json`, `GRAIN_VERSION` in `src/index.ts` and the smoke
test together, then tag `vX.Y.Z` on main and push with `--tags`. See
[CHANGELOG.md](./CHANGELOG.md).
