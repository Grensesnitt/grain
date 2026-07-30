import type { Server } from 'bun';
import { BadRequestError, ForbiddenError } from '../errors/http-error';
import { errorToResponse } from '../errors/error-response';
import { compileValidator } from '../validation/compile';
import type { ParamMeta, RouteSchemas } from '../decorators/metadata';
import type {
  Ctx,
  Guard,
  OnErrorHook,
  OnRequestHook,
  OnResponseHook,
} from '../types';
import { createCtx } from './context';
import { buildExtractors } from './extractors';
import { toResponse } from './respond';

export type CompiledHandler = (
  req: Request,
  server?: Server<unknown> | null
) => Promise<Response>;

export interface CompileRouteInput {
  instance: object;
  handlerName: string;
  httpCode?: number;
  paramMetas: ParamMeta[];
  schemas: RouteSchemas;
  guards: Guard[];
  onRequest: OnRequestHook[];
  onError: OnErrorHook[];
  onResponse: OnResponseHook[];
}

export function compileRoute(input: CompileRouteInput): CompiledHandler {
  const {
    instance,
    handlerName,
    httpCode,
    paramMetas,
    schemas,
    guards,
    onRequest,
    onError,
    onResponse,
  } = input;
  const fn = (instance as Record<string, (...args: unknown[]) => unknown>)[
    handlerName
  ]!.bind(instance);
  const validateBody = schemas.body
    ? compileValidator(schemas.body, 'body')
    : null;
  const validateQuery = schemas.query
    ? compileValidator(schemas.query, 'query')
    : null;
  const validateParams = schemas.params
    ? compileValidator(schemas.params, 'params')
    : null;
  const needsBody =
    validateBody !== null || paramMetas.some((p) => p.kind === 'body');
  const extractors = buildExtractors(paramMetas, fn.length);

  return async (req, server = null) => {
    const setCookies: string[] = [];
    const ctx = createCtx(req, server, setCookies);
    const withCookies = (res: Response): Response => {
      for (const cookie of setCookies) res.headers.append('Set-Cookie', cookie);
      return res;
    };
    const applyOnResponse = async (
      res: Response,
      ctx: Ctx
    ): Promise<Response> => {
      for (const hook of onResponse) {
        const out = await hook(res, ctx);
        if (out instanceof Response) res = out;
      }
      return res;
    };
    try {
      for (const hook of onRequest) {
        const out = await hook(ctx);
        if (out instanceof Response)
          return withCookies(await applyOnResponse(out, ctx));
      }
      for (const guard of guards) {
        if (!(await guard.canActivate(ctx))) throw new ForbiddenError();
      }
      if (validateParams)
        ctx.params = validateParams(ctx.params) as Record<string, any>;
      if (validateQuery)
        ctx.query = validateQuery(ctx.query) as Record<string, any>;
      if (needsBody) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          throw new BadRequestError('Invalid JSON body');
        }
        ctx.body = validateBody ? validateBody(raw) : raw;
      }
      const result = await fn(...extractors.map((extract) => extract(ctx)));
      return withCookies(
        await applyOnResponse(toResponse(result, httpCode), ctx)
      );
    } catch (err) {
      for (const hook of onError) {
        const out = await hook(err, ctx);
        if (out instanceof Response)
          return withCookies(await applyOnResponse(out, ctx));
      }
      return withCookies(await applyOnResponse(errorToResponse(err), ctx));
    }
  };
}
