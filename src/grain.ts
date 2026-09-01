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
import { Container } from './di/container';
import { ConfigError } from './config/config';
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

  constructor(private readonly options: GrainOptions) {
    this.container = new Container(options.env);
    for (const p of options.providers ?? []) this.container.register(p);
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
    // Validate every config class reachable from the graph roots before any
    // instantiation, so a misconfigured boot fails exactly once with the
    // complete list — and no constructor ever runs with an invalid config.
    this.container.preflightConfigs([
      ...this.options.controllers,
      ...(this.options.guards ?? []),
      ...(this.options.gateways ?? []),
    ]);
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

  async handle(req: Request): Promise<Response> {
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

  listen(
    portOrOptions: number | { port?: number; hostname?: string } = 3000
  ): Server<unknown> {
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
        ? { websocket: websocketHandler() }
        : {}),
    } as Parameters<typeof Bun.serve>[0]) as Server<unknown>;
    return this.server;
  }

  stop(): void {
    this.server?.stop(true);
    this.server = null;
  }
}
