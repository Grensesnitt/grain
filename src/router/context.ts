import type { Server } from 'bun';
import type { CookieOptions, Ctx } from '../types';
import { parseCookies, serializeCookie } from './cookies';

export function createCtx(
  req: Request,
  server: Server<unknown> | null = null,
  cookieSink: string[] = []
): Ctx {
  let query: Record<string, any> | null = null;
  let cookies: Record<string, string> | null = null;
  return {
    req,
    params: (req as any).params ?? {},
    store: {},
    body: undefined,
    server,
    setCookie(name: string, value: string, options?: CookieOptions) {
      cookieSink.push(serializeCookie(name, value, options));
    },
    get cookies() {
      cookies ??= parseCookies(req.headers.get('cookie'));
      return cookies;
    },
    get query() {
      query ??= Object.fromEntries(new URL(req.url).searchParams);
      return query;
    },
    set query(value: Record<string, any>) {
      query = value;
    },
  };
}
