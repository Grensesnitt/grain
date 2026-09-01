import type { Server } from 'bun';
import type {
  Ctor,
  Guard,
  HttpMethod,
  OnErrorHook,
  OnRequestHook,
  OnResponseHook,
  WsGateway,
} from './types';
import type { Provider } from './di/provider';
import { Container, WiringError } from './di/container';
import { ConfigError } from './config/config';
import { Logger } from './logging/logger';

const REQUEST_START = '__grainRequestStart';
import { corsResponseHook, preflightHandler, type CorsOptions } from './cors';
import { readGatewayMeta } from './decorators/gateway';
import { readClassGuardMeta, readControllerMeta } from './decorators/metadata';
import { buildOpenApiDoc, type DocsOptions } from './docs/openapi';
import { swaggerHtml } from './docs/ui';
import { errorToResponse } from './errors/error-response';
import { ForbiddenError } from './errors/http-error';
import { compileRoute, type CompiledHandler } from './router/compile-route';
import { createCtx } from './router/context';
import { buildMatcher, type MatcherEntry } from './router/matcher';
import { compileValidator } from './validation/compile';
import { websocketHandler, type WsData } from './router/websocket';

export interface GrainOptions {
  controllers: Ctor[];
  guards?: Ctor<Guard>[];
  providers?: Provider[];
  cors?: CorsOptions;
  docs?: DocsOptions;
  gateways?: Ctor<WsGateway>[];
  /** Source for Config-class validation; defaults to process.env. */
  env?: Record<string, string | undefined>;
  /**
   * Structured logger. Always registered as a DI provider (a default
   * Logger when omitted) and used for request logging with x-request-id
   * correlation; pass one to control level/format/sink.
   */
  logger?: Logger;
}

interface Compiled {
  routes: Record<
    string,
    Partial<Record<HttpMethod | 'OPTIONS', CompiledHandler>>
  >;
  match: ReturnType<typeof buildMatcher>;
}

function notFound(): Response {
  return Response.json(
    { statusCode: 404, error: 'Not Found', message: 'Route not found' },
    { status: 404 }
  );
}

export class Grain {
  private readonly container: Container;
  private readonly onRequestHooks: OnRequestHook[] = [];
  private readonly onErrorHooks: OnErrorHook[] = [];
  private readonly onResponseHooks: OnResponseHook[] = [];
  private corsHook: OnResponseHook | null = null;
  private compiled: Compiled | null = null;
  private server: Server<unknown> | null = null;
  private initPromise: Promise<void> | null = null;
  private shutdownStarted = false;

  private readonly logger: Logger;

  constructor(private readonly options: GrainOptions) {
    this.container = new Container(options.env);
    this.logger = options.logger ?? new Logger();
    // Registered before user providers so an explicit {provide: Logger} wins.
    this.container.register({ provide: Logger, useValue: this.logger });
    for (const p of options.providers ?? []) this.container.register(p);
    // Request logging + correlation id. Pushed first so ctx.store.requestId
    // is set before any user onRequest hook runs.
    this.onRequestHooks.push((ctx) => {
      ctx.store.requestId =
        ctx.req.headers.get('x-request-id') ?? crypto.randomUUID();
      ctx.store[REQUEST_START] = performance.now();
    });
    this.onResponseHooks.push((res, ctx) => {
      // Paths that skip onRequest hooks (404, docs, preflight) get an id here.
      const requestId =
        (ctx.store.requestId as string | undefined) ?? crypto.randomUUID();
      res.headers.set('x-request-id', requestId);
      const start = ctx.store[REQUEST_START] as number | undefined;
      const durationMs =
        start === undefined
          ? undefined
          : Math.round((performance.now() - start) * 1000) / 1000;
      const level =
        res.status >= 500 ? 'error' : res.status >= 400 ? 'warn' : 'info';
      this.logger[level]('request', {
        method: ctx.req.method,
        path: new URL(ctx.req.url).pathname,
        status: res.status,
        durationMs,
        requestId,
      });
    });
    if (options.cors) {
      if (options.cors.origin === '*' && options.cors.credentials) {
        throw new Error("cors: origin '*' cannot be combined with credentials");
      }
      this.corsHook = corsResponseHook(options.cors);
      this.onResponseHooks.push(this.corsHook);
    }
  }

  // Preflight responses already apply CORS headers themselves (via
  // preflightHandler), so routing them through the full onResponseHooks list
  // would re-run corsHook and duplicate the Vary/allow-* headers. This gives
  // preflight only the caller's own onResponse hooks.
  private get userResponseHooks(): OnResponseHook[] {
    return this.corsHook
      ? this.onResponseHooks.filter((hook) => hook !== this.corsHook)
      : this.onResponseHooks;
  }

  onRequest(hook: OnRequestHook): this {
    this.onRequestHooks.push(hook);
    return this;
  }

  onError(hook: OnErrorHook): this {
    this.onErrorHooks.push(hook);
    return this;
  }

  onResponse(hook: OnResponseHook): this {
    this.onResponseHooks.push(hook);
    return this;
  }

  private compile(): Compiled {
    if (this.compiled) return this.compiled;
    const routes: Compiled['routes'] = {};
    // Walk the whole dependency graph before any instantiation, so a broken
    // boot fails exactly once with the complete list — wiring mistakes first
    // (they are more fundamental), then config validation issues — and no
    // constructor ever runs with an invalid config.
    this.container.preflight([
      ...this.options.controllers,
      ...(this.options.guards ?? []),
      ...(this.options.gateways ?? []),
      ...this.container.eagerTokens(),
    ]);
    if (this.container.wiringIssues.length > 0) {
      throw new WiringError([...this.container.wiringIssues]);
    }
    if (this.container.configIssues.length > 0) {
      throw new ConfigError([...this.container.configIssues]);
    }
    const globalGuards = (this.options.guards ?? []).map((g) =>
      this.container.resolve(g)
    );
    for (const controllerClass of this.options.controllers) {
      const instance = this.container.resolve(controllerClass) as object;
      const { routes: metas } = readControllerMeta(controllerClass);
      for (const meta of metas) {
        const handlers = (routes[meta.path] ??= {});
        if (handlers[meta.method]) {
          throw new Error(`Duplicate route: ${meta.method} ${meta.path}`);
        }
        handlers[meta.method] = compileRoute({
          instance,
          handlerName: meta.handlerName,
          httpCode: meta.httpCode,
          paramMetas: meta.params,
          schemas: meta.schemas,
          guards: [
            ...(meta.isPublic ? [] : globalGuards),
            ...meta.guards.map((g) => this.container.resolve(g)),
          ],
          onRequest: this.onRequestHooks,
          onError: this.onErrorHooks,
          onResponse: this.onResponseHooks,
          returns: meta.returns,
        });
      }
    }
    for (const gatewayClass of this.options.gateways ?? []) {
      const meta = readGatewayMeta(gatewayClass);
      const instance = this.container.resolve(gatewayClass) as WsGateway;
      const validate = meta.message
        ? compileValidator(meta.message, 'message')
        : null;
      const { guards: classGuards, isPublic } =
        readClassGuardMeta(gatewayClass);
      const guards = [
        ...(isPublic ? [] : globalGuards),
        ...classGuards.map((g) => this.container.resolve(g) as Guard),
      ];
      const onRequest = this.onRequestHooks;
      const onError = this.onErrorHooks;
      const upgrade: CompiledHandler = async (req, server = null) => {
        const ctx = createCtx(req, server);
        const respond = (res: Response): Promise<Response> =>
          this.applyResponseHooks(res, req, this.onResponseHooks);
        try {
          for (const hook of onRequest) {
            const out = await hook(ctx);
            if (out instanceof Response) return respond(out);
          }
          for (const guard of guards) {
            if (!(await guard.canActivate(ctx))) throw new ForbiddenError();
          }
          if (!server) {
            return respond(new Response('Upgrade Required', { status: 426 }));
          }
          const data: WsData = { ctx, gateway: instance, validate };
          if (server.upgrade(req, { data }))
            return undefined as unknown as Response;
          return respond(new Response('Upgrade failed', { status: 400 }));
        } catch (err) {
          for (const hook of onError) {
            const out = await hook(err, ctx);
            if (out instanceof Response) return respond(out);
          }
          return respond(errorToResponse(err));
        }
      };
      const handlers = (routes[meta.path] ??= {});
      if (handlers.GET)
        throw new Error(`Duplicate route: GET ${meta.path} (gateway)`);
      handlers.GET = upgrade;
    }
    if (this.options.docs) {
      const docsPath = this.options.docs.path ?? '/docs';
      const doc = buildOpenApiDoc(this.options.controllers, this.options.docs);
      // The page is served at docsPath with no trailing slash, so a browser
      // resolves a relative URL against docsPath's *parent* — e.g. from
      // /api/core/docs, `docs/json` resolves to /api/core/docs/json. Using
      // the last path segment (rather than an absolute `${docsPath}/json`)
      // keeps this working behind proxies that strip a path prefix.
      const lastSegment = docsPath.split('/').filter(Boolean).pop() ?? 'docs';
      const relativeJsonUrl = `${lastSegment}/json`;
      const html = swaggerHtml(this.options.docs.info.title, relativeJsonUrl);
      const docsRoutes: [string, CompiledHandler][] = [
        [
          docsPath,
          (req: Request) =>
            this.finalize(
              new Response(html, {
                headers: { 'content-type': 'text/html; charset=utf-8' },
              }),
              req
            ),
        ],
        [
          `${docsPath}/json`,
          (req: Request) => this.finalize(Response.json(doc), req),
        ],
      ];
      for (const [path, handler] of docsRoutes) {
        const handlers = (routes[path] ??= {});
        if (handlers.GET) {
          throw new Error(`Duplicate route: GET ${path} (docs)`);
        }
        handlers.GET = handler;
      }
    }
    if (this.options.cors) {
      const rawPreflight = preflightHandler(this.options.cors);
      const preflight: CompiledHandler = async (req) => {
        const res = await rawPreflight(req);
        return this.applyResponseHooks(res, req, this.userResponseHooks);
      };
      for (const handlers of Object.values(routes)) {
        handlers['OPTIONS'] ??= preflight;
      }
    }
    // Every controller/guard/gateway (and through them, every service) has
    // been resolved by now, so all demanded config classes have validated.
    // Reported here as one aggregated failure — not per class at resolve
    // time — so a boot with several broken configs fails exactly once with
    // the complete list.
    if (this.container.configIssues.length > 0) {
      throw new ConfigError([...this.container.configIssues]);
    }
    const entries: MatcherEntry[] = Object.entries(routes).map(
      ([path, handlers]) => ({
        path,
        handlers,
      })
    );
    this.compiled = { routes, match: buildMatcher(entries) };
    return this.compiled;
  }

  // Compiles the app, instantiates every registered provider (so lifecycle
  // hooks run for un-injected ones like background workers), then awaits each
  // instance's onModuleInit in creation order — dependencies before
  // dependents. Memoized; handle() and listen() call it implicitly.
  init(): Promise<void> {
    this.initPromise ??= this.runInit();
    return this.initPromise;
  }

  private async runInit(): Promise<void> {
    this.compile();
    for (const token of this.container.eagerTokens()) {
      this.container.resolve(token);
    }
    for (const instance of this.container.lifecycleInstances()) {
      const hook = (instance as { onModuleInit?: () => unknown } | null)
        ?.onModuleInit;
      if (typeof hook === 'function') await hook.call(instance);
    }
  }

  // Stops the server and awaits each instance's onModuleDestroy in reverse
  // creation order (dependents before their dependencies). Hook errors are
  // logged, not rethrown, so one failing hook cannot block the rest.
  async shutdown(): Promise<void> {
    if (this.shutdownStarted) return;
    this.shutdownStarted = true;
    this.stop();
    for (const instance of this.container.lifecycleInstances().reverse()) {
      const hook = (instance as { onModuleDestroy?: () => unknown } | null)
        ?.onModuleDestroy;
      if (typeof hook !== 'function') continue;
      try {
        await hook.call(instance);
      } catch (err) {
        this.logger.error('onModuleDestroy failed', { error: err });
      }
    }
  }

  // SIGTERM/SIGINT → shutdown() → exit 0. Call once after listen().
  enableShutdownHooks(signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT']): this {
    for (const signal of signals) {
      process.on(signal, () => {
        void (async () => {
          this.logger.info('shutting down', { signal });
          await this.shutdown();
          process.exit(0);
        })();
      });
    }
    return this;
  }

  async handle(req: Request): Promise<Response> {
    await this.init();
    const { match } = this.compile();
    const matched = match(new URL(req.url).pathname);
    const handler = matched?.handlers[req.method as HttpMethod];
    if (!matched || !handler) return this.finalize(notFound(), req);
    (req as any).params = matched.params;
    return handler(req, this.server);
  }

  private async applyResponseHooks(
    res: Response,
    req: Request,
    hooks: OnResponseHook[]
  ): Promise<Response> {
    const setCookies: string[] = [];
    const ctx = createCtx(req, this.server, setCookies);
    for (const hook of hooks) {
      const out = await hook(res, ctx);
      if (out instanceof Response) res = out;
    }
    for (const cookie of setCookies) res.headers.append('Set-Cookie', cookie);
    return res;
  }

  private finalize(res: Response, req: Request): Promise<Response> {
    return this.applyResponseHooks(res, req, this.onResponseHooks);
  }

  async listen(
    portOrOptions: number | { port?: number; hostname?: string } = 3000
  ): Promise<Server<unknown>> {
    await this.init();
    const { routes } = this.compile();
    const options =
      typeof portOrOptions === 'number'
        ? { port: portOrOptions }
        : portOrOptions;
    // The cast keeps grain consumable as TS source by non-strict consumers:
    // Bun.serve's overloaded Options union (with `{prop?: never}` exclusion
    // arms) resolves differently under `strictNullChecks: false`, rejecting
    // this perfectly valid options object at the consumer's typecheck.
    this.server = Bun.serve({
      port: options.port ?? 3000,
      hostname: options.hostname,
      routes,
      fetch: (req) => this.finalize(notFound(), req),
      ...(this.options.gateways?.length
        ? { websocket: websocketHandler(this.logger) }
        : {}),
    } as Parameters<typeof Bun.serve>[0]) as Server<unknown>;
    return this.server;
  }

  stop(): void {
    this.server?.stop(true);
    this.server = null;
  }
}
