export type Ctor<T = unknown> = new (...args: any[]) => T;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Ctx {
  req: Request;
  params: Record<string, any>;
  query: Record<string, any>;
  store: Record<string, unknown>;
  body: unknown;
}

export interface Guard {
  canActivate(ctx: Ctx): boolean | Promise<boolean>;
}

export type OnRequestHook = (
  ctx: Ctx
) => void | Response | Promise<void | Response>;
export type OnErrorHook = (
  err: unknown,
  ctx: Ctx
) => void | Response | Promise<void | Response>;
