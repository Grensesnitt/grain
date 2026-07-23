import { expect, test } from 'bun:test'
import {
  Body, Controller, Ctx, Get, Grain, HttpCode, Injectable,
  NotFoundError, Param, Post, Query, UnauthorizedError, UseGuard, t,
} from '../src/index'
import type { Ctx as CtxType, Guard } from '../src/index'

@Injectable()
class CounterService {
  private n = 0
  next() { return ++this.n }
}

@Injectable()
class BearerGuard implements Guard {
  constructor(readonly counter: CounterService) {}
  canActivate(ctx: CtxType) {
    const auth = ctx.req.headers.get('authorization')
    if (auth !== 'Bearer secret') throw new UnauthorizedError()
    ctx.store.calls = this.counter.next()
    return true
  }
}

const CreateItem = t.Object({ name: t.String({ minLength: 1 }) })

@Controller('/items')
class ItemController {
  constructor(readonly counter: CounterService) {}

  @Get('/:id', { params: t.Object({ id: t.Number() }) })
  getOne(@Param('id') id: number) {
    if (id === 404) throw new NotFoundError(`item ${id} not found`)
    return { id, typeofId: typeof id }
  }

  @Get('/', { query: t.Object({ page: t.Number() }) })
  list(@Query('page') page: number) {
    return { page }
  }

  @Post('/', { body: CreateItem })
  @HttpCode(201)
  @UseGuard(BearerGuard)
  create(@Body() body: { name: string }, @Ctx() ctx: CtxType) {
    return { created: body.name, calls: ctx.store.calls }
  }
}

function makeApp() {
  return new Grain({ controllers: [ItemController] })
}

test('GET with converted path param', async () => {
  const res = await makeApp().handle(new Request('http://localhost/items/42'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ id: 42, typeofId: 'number' })
})

test('query schema converts values', async () => {
  const res = await makeApp().handle(new Request('http://localhost/items?page=3'))
  expect(await res.json()).toEqual({ page: 3 })
})

test('unknown path and unknown method return the standard 404 shape', async () => {
  const app = makeApp()
  const missing = await app.handle(new Request('http://localhost/nope'))
  expect(missing.status).toBe(404)
  expect(await missing.json()).toEqual({
    statusCode: 404, error: 'Not Found', message: 'Route not found',
  })
  const wrongMethod = await app.handle(
    new Request('http://localhost/items/42', { method: 'DELETE' }),
  )
  expect(wrongMethod.status).toBe(404)
})

test('guard + DI + body validation on POST', async () => {
  const app = makeApp()
  const noAuth = await app.handle(new Request('http://localhost/items', {
    method: 'POST',
    body: JSON.stringify({ name: 'x' }),
    headers: { 'content-type': 'application/json' },
  }))
  expect(noAuth.status).toBe(401)

  const ok = await app.handle(new Request('http://localhost/items', {
    method: 'POST',
    body: JSON.stringify({ name: 'plow' }),
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
  }))
  expect(ok.status).toBe(201)
  expect(await ok.json()).toEqual({ created: 'plow', calls: 1 })

  const invalid = await app.handle(new Request('http://localhost/items', {
    method: 'POST',
    body: JSON.stringify({ name: '' }),
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
  }))
  expect(invalid.status).toBe(400)
})

test('onRequest and onError hooks are applied', async () => {
  const app = makeApp()
  // Hooks are baked into each route's pipeline, so short-circuiting is tested
  // on a registered route (unmatched paths 404 before any hook runs).
  app.onRequest((ctx) => {
    if (ctx.req.headers.get('x-short') === '1') return new Response('cut', { status: 418 })
  })
  const short = await app.handle(
    new Request('http://localhost/items/42', { headers: { 'x-short': '1' } }),
  )
  expect(short.status).toBe(418)
  expect(await short.text()).toBe('cut')

  let observed: unknown
  app.onError((err) => { observed = err })
  await app.handle(new Request('http://localhost/items/404'))
  expect((observed as NotFoundError).statusCode).toBe(404)
})

test('duplicate routes throw at boot', () => {
  @Controller('/dup')
  class DupA { @Get('/x') a() { return 1 } }
  @Controller('/dup')
  class DupB { @Get('/x') b() { return 2 } }
  const app = new Grain({ controllers: [DupA, DupB] })
  // listen() compiles synchronously and throws before Bun.serve is reached.
  // (handle() is async — a sync toThrow would miss its rejected promise.)
  expect(() => app.listen(0)).toThrow('Duplicate route: GET /dup/x')
})

test('handle() and a live Bun server give identical responses', async () => {
  const app = makeApp()
  const server = app.listen(0)
  try {
    const inProcess = await app.handle(new Request('http://localhost/items/42'))
    const overWire = await fetch(`http://localhost:${server.port}/items/42`)
    expect(overWire.status).toBe(inProcess.status)
    expect(await overWire.json()).toEqual(await inProcess.json())
    const wire404 = await fetch(`http://localhost:${server.port}/nope`)
    expect(wire404.status).toBe(404)
    expect(await wire404.json()).toEqual({
      statusCode: 404, error: 'Not Found', message: 'Route not found',
    })
  } finally {
    app.stop()
  }
})

test('overlapping param patterns: handle() matches live Bun.serve precedence', async () => {
  @Controller('/overlap')
  class OverlapController {
    @Get('/:b/c') paramFirst(@Param('b') b: string) { return { via: 'paramFirst', b } }
    @Get('/x/:y') staticX(@Param('y') y: string) { return { via: 'staticX', y } }
  }
  const app = new Grain({ controllers: [OverlapController] })
  const server = app.listen(0)
  try {
    for (const path of ['/overlap/x/c', '/overlap/q/c']) {
      const inProcess = await (await app.handle(new Request(`http://localhost${path}`))).json()
      const overWire = await (await fetch(`http://localhost:${server.port}${path}`)).json()
      expect(inProcess).toEqual(overWire)
    }
  } finally {
    app.stop()
  }
})
