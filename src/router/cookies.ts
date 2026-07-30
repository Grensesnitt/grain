import type { CookieOptions } from '../types';

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[name] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

const SAME_SITE = { strict: 'Strict', lax: 'Lax', none: 'None' } as const;

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  let out = `${name}=${encodeURIComponent(value)}`;
  if (options.domain) out += `; Domain=${options.domain}`;
  if (options.path) out += `; Path=${options.path}`;
  if (options.expires) out += `; Expires=${options.expires.toUTCString()}`;
  if (options.maxAge !== undefined) out += `; Max-Age=${options.maxAge}`;
  if (options.httpOnly) out += '; HttpOnly';
  if (options.secure) out += '; Secure';
  if (options.sameSite) out += `; SameSite=${SAME_SITE[options.sameSite]}`;
  return out;
}
