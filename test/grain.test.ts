import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import {
  BadRequestError,
  Body,
  Controller,
  Ctx,
  Dto,
  Get,
  Grain,
  HttpCode,
  Injectable,
  NotFoundError,
  Param,
  Post,
  Public,
  Query,
  UnauthorizedError,
  UseGuard,
  t,
} from '../src/index';
import type { Ctx as CtxType, Guard } from '../src/index';

@Injectable()
class CounterService {
  private n = 0;
  next() {
    return ++this.n;
  }
}

@Injectable()
class BearerGuard implements Guard {
  constructor(readonly counter: CounterService) {}
  canActivate(ctx: CtxType) {
    const auth = ctx.req.headers.get('authorization');
    if (auth !== 'Bearer secret') throw new UnauthorizedError();
    ctx.store.calls = this.counter.next();
    return true;
  }
}

const CreateItem = t.Object({ name: t.String({ minLength: 1 }) });
class CreateItemDto extends Dto(CreateItem) {}

@Controller('/items')
class ItemController {
  constructor(readonly counter: CounterService) {}

  @Get('/:id')
  getOne(@Param('id') id: number) {
    if (id === 404) throw new NotFoundError(`item ${id} not found`);
    return { id, typeofId: typeof id };
  }

  @Get('/')
  list(@Query('page') page?: number) {
    return { page };
  }

  @Post('/')
  @HttpCode(201)
  @UseGuard(BearerGuard)
  create(@Body() body: CreateItemDto, @Ctx() ctx: CtxType) {
    return { created: body.name, calls: ctx.store.calls };
  }
}

function makeApp() {
  return new Grain({ controllers: [ItemController] });
}

test('GET with converted path param', async () => {
  const res = await makeApp().handle(new Request('http://localhost/items/42'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: 42, typeofId: 'number' });
});

test('query schema converts values', async () => {
  const res = await makeApp().handle(
    new Request('http://localhost/items?page=3')
  );
  expect(await res.json()).toEqual({ page: 3 });
});

test('unknown path and unknown method return the standard 404 shape', async () => {
  const app = makeApp();
  const missing = await app.handle(new Request('http://localhost/nope'));
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({
    statusCode: 404,
    error: 'Not Found',
    message: 'Route not found',
  });
  const wrongMethod = await app.handle(
    new Request('http://localhost/items/42', { method: 'DELETE' })
  );
  expect(wrongMethod.status).toBe(404);
});

test('guard + DI + body validation on POST', async () => {
  const app = makeApp();
  const noAuth = await app.handle(
    new Request('http://localhost/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'x' }),
      headers: { 'content-type': 'application/json' },
    })
  );
  expect(noAuth.status).toBe(401);

  const ok = await app.handle(
    new Request('http://localhost/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'plow' }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
    })
  );
  expect(ok.status).toBe(201);
  expect(await ok.json()).toEqual({ created: 'plow', calls: 1 });

  const invalid = await app.handle(
    new Request('http://localhost/items', {
      method: 'POST',
      body: JSON.stringify({ name: '' }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
    })
  );
  expect(invalid.status).toBe(400);
});

test('onRequest and onError hooks are applied', async () => {
  const app = makeApp();
  // Hooks are baked into each route's pipeline, so short-circuiting is tested
  // on a registered route (unmatched paths 404 before any hook runs).
  app.onRequest((ctx) => {
    if (ctx.req.headers.get('x-short') === '1')
      return new Response('cut', { status: 418 });
  });
  const short = await app.handle(
    new Request('http://localhost/items/42', { headers: { 'x-short': '1' } })
  );
  expect(short.status).toBe(418);
  expect(await short.text()).toBe('cut');

  let observed: unknown;
  app.onError((err) => {
    observed = err;
  });
  await app.handle(new Request('http://localhost/items/404'));
  expect((observed as NotFoundError).statusCode).toBe(404);
});

test('duplicate routes throw at boot', () => {
  @Controller('/dup')
  class DupA {
    @Get('/x') a() {
      return 1;
    }
  }
  @Controller('/dup')
  class DupB {
    @Get('/x') b() {
      return 2;
    }
  }
  const app = new Grain({ controllers: [DupA, DupB] });
  // listen() compiles synchronously and throws before Bun.serve is reached.
  // (handle() is async — a sync toThrow would miss its rejected promise.)
  expect(() => app.listen(0)).toThrow('Duplicate route: GET /dup/x');
});

test('handle() and a live Bun server give identical responses', async () => {
  const app = makeApp();
  const server = app.listen(0);
  try {
    const inProcess = await app.handle(
      new Request('http://localhost/items/42')
    );
    const overWire = await fetch(`http://localhost:${server.port}/items/42`);
    expect(overWire.status).toBe(inProcess.status);
    expect(await overWire.json()).toEqual(await inProcess.json());
    const wire404 = await fetch(`http://localhost:${server.port}/nope`);
    expect(wire404.status).toBe(404);
    expect(await wire404.json()).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Route not found',
    });
  } finally {
    app.stop();
  }
});

test('overlapping param patterns: handle() matches live Bun.serve precedence', async () => {
  @Controller('/overlap')
  class OverlapController {
    @Get('/:b/c') paramFirst(@Param('b') b: string) {
      return { via: 'paramFirst', b };
    }
    @Get('/x/:y') staticX(@Param('y') y: string) {
      return { via: 'staticX', y };
    }
  }
  const app = new Grain({ controllers: [OverlapController] });
  const server = app.listen(0);
  try {
    for (const path of ['/overlap/x/c', '/overlap/q/c']) {
      const inProcessRes = await app.handle(
        new Request(`http://localhost${path}`)
      );
      const overWireRes = await fetch(`http://localhost:${server.port}${path}`);
      expect(overWireRes.status).toBe(inProcessRes.status);
      const inProcess = await inProcessRes.json();
      const overWire = await overWireRes.json();
      expect(inProcess).toEqual(overWire);
    }
  } finally {
    app.stop();
  }
});

@Injectable()
class GlobalOrderGuard implements Guard {
  canActivate(ctx: CtxType) {
    ((ctx.store.order ??= []) as string[]).push('global');
    return true;
  }
}

@Injectable()
class ClassOrderGuard implements Guard {
  canActivate(ctx: CtxType) {
    ((ctx.store.order ??= []) as string[]).push('class');
    return true;
  }
}

@Injectable()
class MethodOrderGuard implements Guard {
  canActivate(ctx: CtxType) {
    ((ctx.store.order ??= []) as string[]).push('method');
    return true;
  }
}

@Injectable()
class DenyService {
  readonly reason = 'denied by DI-injected service';
}

@Injectable()
class DenyGuard implements Guard {
  constructor(readonly deny: DenyService) {}
  canActivate(): boolean {
    throw new UnauthorizedError(this.deny.reason);
  }
}

@Controller('/g')
@UseGuard(ClassOrderGuard)
class GuardedController {
  @Get('/order')
  @UseGuard(MethodOrderGuard)
  order(@Ctx() ctx: CtxType) {
    return { order: ctx.store.order };
  }

  @Get('/open')
  @Public()
  open(@Ctx() ctx: CtxType) {
    return { order: ctx.store.order ?? [] };
  }
}

@Controller('/pub')
@Public()
class PublicController {
  @Get('/a')
  a() {
    return { ok: true };
  }
}

test('global guards run on every route, ordered global → class → method', async () => {
  const app = new Grain({
    controllers: [GuardedController],
    guards: [GlobalOrderGuard],
  });
  const res = await app.handle(new Request('http://localhost/g/order'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ order: ['global', 'class', 'method'] });
});

test('@Public on a method skips global guards but keeps local guards', async () => {
  const app = new Grain({
    controllers: [GuardedController],
    guards: [GlobalOrderGuard],
  });
  const res = await app.handle(new Request('http://localhost/g/open'));
  expect(await res.json()).toEqual({ order: ['class'] });
});

test('@Public on a controller exempts all its routes from global guards', async () => {
  const app = new Grain({
    controllers: [PublicController],
    guards: [DenyGuard],
  });
  const res = await app.handle(new Request('http://localhost/pub/a'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test('global guards get DI and their failures map like any guard', async () => {
  const app = new Grain({
    controllers: [GuardedController, PublicController],
    guards: [DenyGuard],
  });
  const denied = await app.handle(new Request('http://localhost/g/order'));
  expect(denied.status).toBe(401);
  expect(((await denied.json()) as { message: string }).message).toBe(
    'denied by DI-injected service'
  );
  const open = await app.handle(new Request('http://localhost/pub/a'));
  expect(open.status).toBe(200);
});

@Controller('/pubguarded')
@Public()
@UseGuard(ClassOrderGuard)
class PublicGuardedController {
  @Get('/x')
  x(@Ctx() ctx: CtxType) {
    return { order: ctx.store.order ?? [] };
  }
}

test('class-level @Public skips global guards but keeps class-level @UseGuard', async () => {
  const app = new Grain({
    controllers: [PublicGuardedController],
    guards: [GlobalOrderGuard],
  });
  const res = await app.handle(new Request('http://localhost/pubguarded/x'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ order: ['class'] });
});

test('hostile paths: handle() and live Bun.serve agree on status', async () => {
  const app = makeApp();
  const server = app.listen(0);
  try {
    const paths = [
      '/items/42/',
      '/items//42',
      '//items/42',
      '/items/%zz',
      '/items/%2F',
    ];
    for (const path of paths) {
      const inProcess = await app.handle(
        new Request(`http://localhost${path}`)
      );
      const overWire = await fetch(`http://localhost:${server.port}${path}`);
      expect(`${path} -> ${overWire.status}`).toBe(
        `${path} -> ${inProcess.status}`
      );
    }
  } finally {
    app.stop();
  }
});

class OptionalProbeController {
  @Get('/probe')
  probe(@Query('page') _page?: number) {
    return null;
  }
}

test('EVIDENCE: Bun emits Number in design:paramtypes for an optional annotated param', () => {
  const types = Reflect.getMetadata(
    'design:paramtypes',
    OptionalProbeController.prototype,
    'probe'
  ) as unknown[];
  expect(types[0]).toBe(Number);
});

const WholeQuery = t.Object({ page: t.Number(), size: t.Number() });
class WholeQueryDto extends Dto(WholeQuery) {}

@Controller('/derive')
class DeriveController {
  @Get('/optional')
  optional(@Query('page') page?: number) {
    return { page: page ?? null, type: typeof page };
  }

  @Get('/whole')
  whole(@Query() q: WholeQueryDto, @Query('page') _ignored?: number) {
    return q;
  }

  @Get('/raw-body-check/:slug')
  slugRoute(@Param('slug') slug: string) {
    return { slug, type: typeof slug };
  }

  @Get('/flag')
  flag(@Query('flag') flag?: boolean) {
    return { flag: flag ?? null, type: typeof flag };
  }
}

interface RawShape {
  anything: string;
}

@Controller('/rawbody')
class RawBodyController {
  @Post('/')
  create(@Body() body: RawShape) {
    return { received: body };
  }
}

test('absent optional query passes; present invalid query 400s; present valid coerces', async () => {
  const app = new Grain({ controllers: [DeriveController] });
  const absent = await app.handle(
    new Request('http://localhost/derive/optional')
  );
  expect(await absent.json()).toEqual({ page: null, type: 'undefined' });
  const invalid = await app.handle(
    new Request('http://localhost/derive/optional?page=abc')
  );
  expect(invalid.status).toBe(400);
  const valid = await app.handle(
    new Request('http://localhost/derive/optional?page=7')
  );
  expect(await valid.json()).toEqual({ page: 7, type: 'number' });
});

test('whole-object Dto wins over named primitive derivations for the slot', async () => {
  const app = new Grain({ controllers: [DeriveController] });
  // WholeQuery REQUIRES size — if the named t.Optional(page) derivation had
  // won or merged, this request would pass; under the Dto schema it 400s.
  const missingSize = await app.handle(
    new Request('http://localhost/derive/whole?page=1')
  );
  expect(missingSize.status).toBe(400);
  const ok = await app.handle(
    new Request('http://localhost/derive/whole?page=1&size=2')
  );
  expect(await ok.json()).toEqual({ page: 1, size: 2 });
});

test('string-typed params derive nothing and stay strings', async () => {
  const app = new Grain({ controllers: [DeriveController] });
  const res = await app.handle(
    new Request('http://localhost/derive/raw-body-check/abc')
  );
  expect(await res.json()).toEqual({ slug: 'abc', type: 'string' });
});

test('named boolean query params coerce and validate', async () => {
  const app = new Grain({ controllers: [DeriveController] });
  const on = await app.handle(
    new Request('http://localhost/derive/flag?flag=true')
  );
  expect(await on.json()).toEqual({ flag: true, type: 'boolean' });
  const invalid = await app.handle(
    new Request('http://localhost/derive/flag?flag=nope')
  );
  expect(invalid.status).toBe(400);
  const absent = await app.handle(new Request('http://localhost/derive/flag'));
  expect(await absent.json()).toEqual({ flag: null, type: 'undefined' });
});

test('interface-typed body stays raw (no validation)', async () => {
  const app = new Grain({ controllers: [RawBodyController] });
  const res = await app.handle(
    new Request('http://localhost/rawbody', {
      method: 'POST',
      body: JSON.stringify({ totally: 'unvalidated', extra: 1 }),
      headers: { 'content-type': 'application/json' },
    })
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    received: { totally: 'unvalidated', extra: 1 },
  });
});

describe('cookies and server ctx', () => {
  @Controller('/cookie')
  class CookieController {
    @Get('/read')
    read(@Ctx() ctx: Ctx) {
      return { seen: ctx.cookies['Session'] ?? null };
    }

    @Get('/set')
    set(@Ctx() ctx: Ctx) {
      ctx.setCookie('Session', 'abc123', {
        path: '/api',
        httpOnly: true,
        sameSite: 'strict',
        expires: new Date('2027-01-01T00:00:00Z'),
      });
      return { ok: true };
    }

    @Get('/boom')
    boom(@Ctx() ctx: Ctx) {
      ctx.setCookie('Session', '', { path: '/api', expires: new Date(0) });
      throw new BadRequestError('after cookie');
    }
  }

  const app = () => new Grain({ controllers: [CookieController] });

  test('ctx.cookies parses the Cookie header', async () => {
    const res = await app().handle(
      new Request('http://x/cookie/read', {
        headers: { cookie: 'Session=abc123; Other=1' },
      })
    );
    expect(await res.json()).toEqual({ seen: 'abc123' });
  });

  test('setCookie serializes attributes onto the response', async () => {
    const res = await app().handle(new Request('http://x/cookie/set'));
    const header = res.headers.get('set-cookie')!;
    expect(header).toContain('Session=abc123');
    expect(header).toContain('Path=/api');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Expires=');
  });

  test('cookies set before a thrown error still reach the error response', async () => {
    const res = await app().handle(new Request('http://x/cookie/boom'));
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toContain('Session=');
  });

  test('ctx.server is null under handle()', async () => {
    @Controller('/srv')
    class SrvController {
      @Get('/')
      srv(@Ctx() ctx: Ctx) {
        return { hasServer: ctx.server !== null };
      }
    }
    const res = await new Grain({ controllers: [SrvController] }).handle(
      new Request('http://x/srv')
    );
    expect(await res.json()).toEqual({ hasServer: false });
  });

  test('listen accepts {port, hostname}', async () => {
    const srv = app().listen({ port: 0, hostname: '127.0.0.1' });
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/cookie/read`);
      expect(res.status).toBe(200);
    } finally {
      srv.stop(true);
    }
  });

  test('cookies set in an onRequest hook survive its short-circuit response', async () => {
    const hooked = app().onRequest((ctx) => {
      ctx.setCookie('Session', 'hooked', { path: '/api' });
      return new Response('cut', { status: 418 });
    });
    const res = await hooked.handle(new Request('http://x/cookie/read'));
    expect(res.status).toBe(418);
    const header = res.headers.get('set-cookie')!;
    expect(header).toContain('Session=hooked');
    expect(header).toContain('Path=/api');
  });

  test('missing Cookie header parses to an empty object', async () => {
    const res = await app().handle(new Request('http://x/cookie/read'));
    expect(await res.json()).toEqual({ seen: null });
  });

  test('malformed percent-encoding falls back to the raw cookie value', async () => {
    const res = await app().handle(
      new Request('http://x/cookie/read', {
        headers: { cookie: 'Session=%E0%A4%A' },
      })
    );
    expect(await res.json()).toEqual({ seen: '%E0%A4%A' });
  });

  test('cookie value containing = keeps everything after the first =', async () => {
    const res = await app().handle(
      new Request('http://x/cookie/read', {
        headers: { cookie: 'Session=a=b' },
      })
    );
    expect(await res.json()).toEqual({ seen: 'a=b' });
  });
});
