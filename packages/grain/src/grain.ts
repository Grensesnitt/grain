import type { Server } from 'bun';
import type { Ctor, HttpMethod, OnErrorHook, OnRequestHook } from './types';
import { Container } from './di/container';
import { readControllerMeta } from './decorators/metadata';
import { compileRoute, type CompiledHandler } from './router/compile-route';
import { buildMatcher, type MatcherEntry } from './router/matcher';

export interface GrainOptions {
  controllers: Ctor[];
}

interface Compiled {
  routes: Record<string, Partial<Record<HttpMethod, CompiledHandler>>>;
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
  private compiled: Compiled | null = null;
  private server: Server<undefined> | null = null;

  constructor(private readonly options: GrainOptions) {}

  onRequest(hook: OnRequestHook): this {
    this.onRequestHooks.push(hook);
    return this;
  }

  onError(hook: OnErrorHook): this {
    this.onErrorHooks.push(hook);
    return this;
  }

  private compile(): Compiled {
    if (this.compiled) return this.compiled;
    const routes: Compiled['routes'] = {};
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
          guards: meta.guards.map((g) => this.container.resolve(g)),
          onRequest: this.onRequestHooks,
          onError: this.onErrorHooks,
        });
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
    if (!matched || !handler) return notFound();
    (req as any).params = matched.params;
    return handler(req);
  }

  listen(port = 3000): Server<undefined> {
    const { routes } = this.compile();
    this.server = Bun.serve({
      port,
      routes,
      fetch: () => notFound(),
    });
    return this.server;
  }

  stop(): void {
    this.server?.stop(true);
    this.server = null;
  }
}
