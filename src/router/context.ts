import type { Ctx } from '../types';

export function createCtx(req: Request): Ctx {
  let query: Record<string, any> | null = null;
  return {
    req,
    params: (req as any).params ?? {},
    store: {},
    body: undefined,
    get query() {
      query ??= Object.fromEntries(new URL(req.url).searchParams);
      return query;
    },
    set query(value: Record<string, any>) {
      query = value;
    },
  };
}
