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
  private readonly container = new Container();
  private readonly onRequestHooks: OnRequestHook[] = [];
  private readonly onErrorHooks: OnErrorHook[] = [];
  private readonly onResponseHooks: OnResponseHook[] = [];
  private compiled: Compiled | null = null;
  private server: Server<unknown> | null = null;

  constructor(private readonly options: GrainOptions) {
    for (const p of options.providers ?? []) this.container.register(p);
    if (options.cors) {
      if (options.cors.origin === '*' && options.cors.credentials) {
        throw new Error("cors: origin '*' cannot be combined with credentials");
      }
      this.onResponseHooks.push(corsResponseHook(options.cors));
    }
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
        });
      }
    }
    for (const gatewayClass of this.options.gateways ?? []) {
      const meta = readGatewayMeta(gatewayClass);
      const instance = this.container.resolve(gatewayClass) as WsGateway;
      const validate = meta.message
        ? compileValidator(meta.message, 'body')
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
        try {
          for (const hook of onRequest) {
            const out = await hook(ctx);
            if (out instanceof Response) return out;
          }
          for (const guard of guards) {
            if (!(await guard.canActivate(ctx))) throw new ForbiddenError();
          }
          if (!server) {
            return new Response('Upgrade Required', { status: 426 });
          }
          const data: WsData = { ctx, gateway: instance, validate };
          if (server.upgrade(req, { data }))
            return undefined as unknown as Response;
          return new Response('Upgrade failed', { status: 400 });
        } catch (err) {
          for (const hook of onError) {
            const out = await hook(err, ctx);
            if (out instanceof Response) return out;
          }
          return errorToResponse(err);
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
      const html = swaggerHtml(
        this.options.docs.info.title,
        `${docsPath}/json`
      );
      const docsRoutes: [string, CompiledHandler][] = [
        [
          docsPath,
          async () =>
            new Response(html, {
              headers: { 'content-type': 'text/html; charset=utf-8' },
            }),
        ],
        [`${docsPath}/json`, async () => Response.json(doc)],
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
      const preflight = preflightHandler(this.options.cors);
      for (const handlers of Object.values(routes)) {
        handlers['OPTIONS'] ??= preflight;
      }
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

  private async finalize(res: Response, req: Request): Promise<Response> {
    const setCookies: string[] = [];
    const ctx = createCtx(req, this.server, setCookies);
    for (const hook of this.onResponseHooks) {
      const out = await hook(res, ctx);
      if (out instanceof Response) res = out;
    }
    for (const cookie of setCookies) res.headers.append('Set-Cookie', cookie);
    return res;
  }

  listen(
    portOrOptions: number | { port?: number; hostname?: string } = 3000
  ): Server<unknown> {
    const { routes } = this.compile();
    const options =
      typeof portOrOptions === 'number'
        ? { port: portOrOptions }
        : portOrOptions;
    this.server = Bun.serve({
      port: options.port ?? 3000,
      hostname: options.hostname,
      routes,
      fetch: (req) => this.finalize(notFound(), req),
      ...(this.options.gateways?.length
        ? { websocket: websocketHandler() }
        : {}),
    });
    return this.server;
  }

  stop(): void {
    this.server?.stop(true);
    this.server = null;
  }
}
