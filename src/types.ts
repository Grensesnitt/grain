import type { Server } from 'bun';

export type Ctor<T = unknown> = new (...args: any[]) => T;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface CookieOptions {
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  expires?: Date;
  maxAge?: number;
}

export interface Ctx {
  req: Request;
  params: Record<string, any>;
  query: Record<string, any>;
  store: Record<string, unknown>;
  body: unknown;
  server: Server<undefined> | null;
  cookies: Record<string, string>;
  setCookie(name: string, value: string, options?: CookieOptions): void;
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
export type OnResponseHook = (
  res: Response,
  ctx: Ctx
) => void | Response | Promise<void | Response>;
