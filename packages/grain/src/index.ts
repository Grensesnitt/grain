import 'reflect-metadata'
import './validation/formats'
import type { Ctx as CtxShape } from './types'

export const GRAIN_VERSION = '0.1.0'

export { Grain, type GrainOptions } from './grain'
export { Controller } from './decorators/controller'
export { Delete, Get, Patch, Post, Put } from './decorators/route'
export { Body, Ctx, Param, Query } from './decorators/params'
export { HttpCode } from './decorators/http-code'
export { UseGuard } from './decorators/use-guard'
export { Injectable } from './di/injectable'
export {
  BadRequestError, ConflictError, ForbiddenError, HttpError,
  NotFoundError, UnauthorizedError, ValidationError,
} from './errors/http-error'
// The `Ctx` decorator (value, re-exported above from './decorators/params')
// and the `Ctx` interface (type, below) intentionally share the identifier so
// `@Ctx() ctx: Ctx` works with a single import. TypeScript cannot merge a
// value export and a type export of the same name across two separate
// `export ... from` re-export statements (TS2300 "Duplicate identifier"), so
// the type half is declared locally and merges with the value export instead.
export interface Ctx extends CtxShape {}
export type { Guard, HttpMethod, OnErrorHook, OnRequestHook } from './types'
export type { RouteSchemas } from './decorators/metadata'
export { Type as t } from '@sinclair/typebox'
export type { Static, TSchema } from '@sinclair/typebox'
