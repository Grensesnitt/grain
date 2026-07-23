import 'reflect-metadata'
import { expect, test } from 'bun:test'
import { Type as t } from '@sinclair/typebox'
import { Controller } from '../src/decorators/controller'
import { Delete, Get, Patch, Post, Put } from '../src/decorators/route'
import { Body, Ctx, Param, Query } from '../src/decorators/params'
import { HttpCode } from '../src/decorators/http-code'
import { UseGuard } from '../src/decorators/use-guard'
import { joinPath, readControllerMeta } from '../src/decorators/metadata'
import { isInjectable } from '../src/di/injectable'
import type { Ctx as CtxType, Guard } from '../src/types'

class GuardA implements Guard { canActivate() { return true } }
class GuardB implements Guard { canActivate() { return true } }

const CreateThing = t.Object({ name: t.String() })

@Controller('/things')
@UseGuard(GuardA)
class ThingController {
  @Get('/:id')
  getOne(@Param('id') _id: string, @Ctx() _ctx: CtxType) { return null }

  @Post('/', { body: CreateThing })
  @HttpCode(201)
  @UseGuard(GuardB)
  create(@Body() _body: unknown) { return null }

  @Get('/')
  list(@Query() _q: Record<string, any>) { return null }

  @Put('/:id') update() { return null }
  @Patch('/:id') patch() { return null }
  @Delete('/:id') remove() { return null }
}

test('joinPath handles slashes', () => {
  expect(joinPath('/users', '/:id')).toBe('/users/:id')
  expect(joinPath('/users', '/')).toBe('/users')
  expect(joinPath('/users', '')).toBe('/users')
  expect(joinPath('/', '/health')).toBe('/health')
  expect(joinPath('', '/health')).toBe('/health')
  expect(joinPath('/', '/')).toBe('/')
})

test('@Controller marks the class injectable and stores the prefix', () => {
  expect(isInjectable(ThingController)).toBe(true)
  expect(readControllerMeta(ThingController).prefix).toBe('/things')
})

test('routes carry method, joined path, handler name and schemas', () => {
  const { routes } = readControllerMeta(ThingController)
  const byName = Object.fromEntries(routes.map((r) => [r.handlerName, r]))
  expect(routes).toHaveLength(6)
  expect(byName.getOne).toMatchObject({ method: 'GET', path: '/things/:id' })
  expect(byName.create).toMatchObject({ method: 'POST', path: '/things', httpCode: 201 })
  expect(byName.create.schemas.body).toBe(CreateThing)
  expect(byName.list).toMatchObject({ method: 'GET', path: '/things' })
  expect(byName.update.method).toBe('PUT')
  expect(byName.patch.method).toBe('PATCH')
  expect(byName.remove.method).toBe('DELETE')
})

test('param metadata records kind, name and index in order', () => {
  const { routes } = readControllerMeta(ThingController)
  const getOne = routes.find((r) => r.handlerName === 'getOne')!
  expect(getOne.params).toEqual([
    { index: 0, kind: 'param', name: 'id' },
    { index: 1, kind: 'ctx', name: undefined },
  ])
  const list = routes.find((r) => r.handlerName === 'list')!
  expect(list.params).toEqual([{ index: 0, kind: 'query', name: undefined }])
})

test('guards merge controller-level first, then method-level', () => {
  const { routes } = readControllerMeta(ThingController)
  const create = routes.find((r) => r.handlerName === 'create')!
  expect(create.guards).toEqual([GuardA, GuardB])
  const getOne = routes.find((r) => r.handlerName === 'getOne')!
  expect(getOne.guards).toEqual([GuardA])
})

test('a controller without prefix defaults to root', () => {
  @Controller()
  class Root { @Get('/health') health() { return { ok: true } } }
  const meta = readControllerMeta(Root)
  expect(meta.prefix).toBe('/')
  expect(meta.routes[0]!.path).toBe('/health')
})
