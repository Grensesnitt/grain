import 'reflect-metadata';
import './validation/formats';
import type { Ctx as CtxShape } from './types';

export const GRAIN_VERSION = '0.5.0';

export { Grain, type GrainOptions } from './grain';
export type { CorsOptions } from './cors';
export { Controller } from './decorators/controller';
export { Delete, Get, Patch, Post, Put } from './decorators/route';
export { Body, Ctx, Param, Query } from './decorators/params';
export { Docs } from './decorators/docs';
export { Gateway } from './decorators/gateway';
export { HttpCode } from './decorators/http-code';
export { Public } from './decorators/public';
export { Returns } from './decorators/returns';
export { UseGuard } from './decorators/use-guard';
export { Injectable } from './di/injectable';
export type { Provider } from './di/provider';
export {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from './errors/http-error';
export { Dto } from './validation/dto';
export type { DocsOptions } from './docs/openapi';
// The `Ctx` decorator (value, re-exported above from './decorators/params')
// and the `Ctx` interface (type, below) intentionally share the identifier so
// `@Ctx() ctx: Ctx` works with a single import. TypeScript cannot merge a
// value export and a type export of the same name across two separate
// `export ... from` re-export statements (TS2300 "Duplicate identifier"), so
// the type half is declared locally and merges with the value export instead.
export interface Ctx extends CtxShape {}
export type {
  CookieOptions,
  Guard,
  HttpMethod,
  OnErrorHook,
  OnRequestHook,
  OnResponseHook,
  WsClient,
  WsGateway,
} from './types';
export { Type as t } from '@sinclair/typebox';
export type { Static, TSchema } from '@sinclair/typebox';
