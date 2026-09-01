import 'reflect-metadata';
// Aliased: this module also exports the `Ctx` decorator (value), and TS
// refuses to merge a local type import with an exported const of the same name.
import type { Ctx as CtxShape } from '../types';
import { PARAMS, type ParamMeta } from './metadata';

function addParamMeta(
  target: object,
  propertyKey: string | symbol | undefined,
  meta: ParamMeta
): void {
  if (propertyKey === undefined) return;
  const ctor = target.constructor;
  const params: ParamMeta[] =
    Reflect.getMetadata(PARAMS, ctor, propertyKey) ?? [];
  params.push(meta);
  Reflect.defineMetadata(PARAMS, params, ctor, propertyKey);
}

function builtinParamDecorator(kind: ParamMeta['kind']) {
  return (name?: string): ParameterDecorator =>
    (target, propertyKey, parameterIndex) =>
      addParamMeta(target as object, propertyKey, {
        index: parameterIndex,
        kind,
        name,
      });
}

export const Body = builtinParamDecorator('body');
export const Param = builtinParamDecorator('param');
export const Query = builtinParamDecorator('query');
export const Ctx = builtinParamDecorator('ctx');

// NestJS-style custom param decorators, built on ctx (typically ctx.store,
// where guards stash request-scoped values):
//
//   const CurrentUser = createParamDecorator((ctx) => ctx.store.user);
//   ...
//   @Get('/') read(@CurrentUser() user: UserInterface) { ... }
//
// Custom slots are excluded from schema derivation — the parameter's declared
// type is documentation only, like @Ctx().
export function createParamDecorator(
  factory: (ctx: CtxShape) => unknown
): () => ParameterDecorator {
  return () => (target, propertyKey, parameterIndex) =>
    addParamMeta(target as object, propertyKey, {
      index: parameterIndex,
      kind: 'custom',
      factory,
    });
}
