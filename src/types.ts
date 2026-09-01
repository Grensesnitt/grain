import type { Server } from 'bun';

export type Ctor<T = unknown> = new (...args: any[]) => T;

// Lifecycle hooks are duck-typed at runtime (any instance with the method
// participates) — these interfaces exist for declaration ergonomics.
export interface OnModuleInit {
  onModuleInit(): void | Promise<void>;
}

export interface OnModuleDestroy {
  onModuleDestroy(): void | Promise<void>;
}

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
  server: Server<unknown> | null;
  cookies: Record<string, string>;
  setCookie(name: string, value: string, options?: CookieOptions): void;
}

export interface Guard {
  canActivate(ctx: Ctx): boolean | Promise<boolean>;
}

export interface WsClient {
  id: string;
  ctx: Ctx;
  send(data: unknown): void; // JSON.stringify + ws.send
  close(code?: number, reason?: string): void;
}

export interface WsGateway<M = unknown> {
  open?(client: WsClient): void | Promise<void>;
  message?(client: WsClient, message: M): void | Promise<void>;
  close?(client: WsClient): void | Promise<void>;
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
