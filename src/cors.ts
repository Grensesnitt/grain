import type { OnResponseHook } from './types';

export interface CorsOptions {
  origin?: boolean | string | string[];
  credentials?: boolean;
  methods?: string[];
  allowedHeaders?: string[];
  maxAge?: number;
}

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function resolveOrigin(
  options: CorsOptions,
  requestOrigin: string | null
): string | null {
  const { origin = true } = options;
  if (origin === false) return null;
  if (origin === true) return requestOrigin;
  if (typeof origin === 'string') return origin;
  return requestOrigin !== null && origin.includes(requestOrigin)
    ? requestOrigin
    : null;
}

export function applyCorsHeaders(
  options: CorsOptions,
  req: Request,
  headers: Headers
): void {
  const allowed = resolveOrigin(options, req.headers.get('origin'));
  if (allowed === null) return;
  headers.set('access-control-allow-origin', allowed);
  if (options.credentials)
    headers.set('access-control-allow-credentials', 'true');
  headers.append('vary', 'Origin');
}

export function corsResponseHook(options: CorsOptions): OnResponseHook {
  return (res, ctx) => {
    applyCorsHeaders(options, ctx.req, res.headers);
  };
}

export function preflightHandler(
  options: CorsOptions
): (req: Request) => Promise<Response> {
  return async (req) => {
    const headers = new Headers();
    applyCorsHeaders(options, req, headers);
    headers.set(
      'access-control-allow-methods',
      (options.methods ?? DEFAULT_METHODS).join(', ')
    );
    const requested = req.headers.get('access-control-request-headers');
    const allowHeaders = options.allowedHeaders?.join(',') ?? requested;
    if (allowHeaders) headers.set('access-control-allow-headers', allowHeaders);
    if (options.maxAge !== undefined)
      headers.set('access-control-max-age', String(options.maxAge));
    return new Response(null, { status: 204, headers });
  };
}
