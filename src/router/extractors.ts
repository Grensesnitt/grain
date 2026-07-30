import type { ParamMeta } from '../decorators/metadata';
import type { Ctx } from '../types';

export function buildExtractors(
  params: ParamMeta[],
  arity: number
): Array<(ctx: Ctx) => unknown> {
  const byIndex = new Map(params.map((p) => [p.index, p]));
  const count = Math.max(arity, ...params.map((p) => p.index + 1), 0);
  return Array.from({ length: count }, (_, i) => {
    const meta = byIndex.get(i);
    if (!meta) return () => undefined;
    switch (meta.kind) {
      case 'ctx':
        return (ctx: Ctx) => ctx;
      case 'body':
        return (ctx: Ctx) => ctx.body;
      case 'param':
        return meta.name !== undefined
          ? (ctx: Ctx) => ctx.params[meta.name!]
          : (ctx: Ctx) => ctx.params;
      case 'query':
        return meta.name !== undefined
          ? (ctx: Ctx) => ctx.query[meta.name!]
          : (ctx: Ctx) => ctx.query;
    }
  });
}
