import { expect, test } from 'bun:test';
import { Type as t } from '@sinclair/typebox';
import {
  compileRoute,
  type CompileRouteInput,
} from '../src/router/compile-route';
import { NotFoundError, UnauthorizedError } from '../src/errors/http-error';
import type { Ctx, Guard } from '../src/types';

function makeRoute(overrides: Partial<CompileRouteInput> = {}) {
  const instance = {
    hello() {
      return { hello: 'world' };
    },
    echoBody(body: unknown) {
      return { received: body };
    },
    echoParams(params: Record<string, any>, query: Record<string, any>) {
      return { params, query };
    },
    fromStore(ctx: Ctx) {
      return { user: ctx.store.user };
    },
    boom() {
      throw new Error('kaboom');
    },
    missing() {
      throw new NotFoundError('nope');
    },
    nothing() {
      return undefined;
    },
  };
  return compileRoute({
    instance,
    handlerName: 'hello',
    paramMetas: [],
    schemas: {},
    guards: [],
    onRequest: [],
    onError: [],
    ...overrides,
  });
}

const post = (body: unknown) =>
  new Request('http://localhost/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

test('happy path: handler return value becomes JSON 200', async () => {
  const res = await makeRoute()(new Request('http://localhost/x'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ hello: 'world' });
});

test('httpCode override and undefined → 204', async () => {
  const created = await makeRoute({ httpCode: 201 })(
    new Request('http://localhost/x')
  );
  expect(created.status).toBe(201);
  const empty = await makeRoute({ handlerName: 'nothing' })(
    new Request('http://localhost/x')
  );
  expect(empty.status).toBe(204);
});

test('body is validated and passed to @Body() position', async () => {
  const handler = makeRoute({
    handlerName: 'echoBody',
    paramMetas: [{ index: 0, kind: 'body' }],
    schemas: { body: t.Object({ name: t.String({ minLength: 1 }) }) },
  });
  const ok = await handler(post({ name: 'Runar' }));
  expect(await ok.json()).toEqual({ received: { name: 'Runar' } });
  const bad = await handler(post({ name: '' }));
  expect(bad.status).toBe(400);
  const body = (await bad.json()) as { error: string; details: unknown[] };
  expect(body.error).toBe('Validation Failed');
  expect(body.details.length).toBe(1);
});

test('malformed JSON body → 400 Invalid JSON body', async () => {
  const handler = makeRoute({
    handlerName: 'echoBody',
    paramMetas: [{ index: 0, kind: 'body' }],
  });
  const res = await handler(
    new Request('http://localhost/x', { method: 'POST', body: '{oops' })
  );
  expect(res.status).toBe(400);
  expect(((await res.json()) as { message: string }).message).toBe(
    'Invalid JSON body'
  );
});

test('params and query are converted by their schemas', async () => {
  const handler = makeRoute({
    handlerName: 'echoParams',
    paramMetas: [
      { index: 0, kind: 'param' },
      { index: 1, kind: 'query' },
    ],
    schemas: {
      params: t.Object({ id: t.Number() }),
      query: t.Object({ page: t.Number() }),
    },
  });
  const req = new Request('http://localhost/x?page=3');
  (req as any).params = { id: '42' };
  const res = await handler(req);
  expect(await res.json()).toEqual({ params: { id: 42 }, query: { page: 3 } });
});

test('guard returning false → 403; guard exceptions propagate', async () => {
  const denyAll: Guard = { canActivate: () => false };
  const denied = await makeRoute({ guards: [denyAll] })(
    new Request('http://localhost/x')
  );
  expect(denied.status).toBe(403);

  const throwing: Guard = {
    canActivate: () => {
      throw new UnauthorizedError();
    },
  };
  const unauthorized = await makeRoute({ guards: [throwing] })(
    new Request('http://localhost/x')
  );
  expect(unauthorized.status).toBe(401);
});

test('guards run in order and can populate ctx.store for the handler', async () => {
  const order: string[] = [];
  const first: Guard = {
    canActivate: (ctx) => {
      order.push('first');
      ctx.store.user = 'runar';
      return true;
    },
  };
  const second: Guard = {
    canActivate: () => {
      order.push('second');
      return true;
    },
  };
  const handler = makeRoute({
    handlerName: 'fromStore',
    paramMetas: [{ index: 0, kind: 'ctx' }],
    guards: [first, second],
  });
  const res = await handler(new Request('http://localhost/x'));
  expect(order).toEqual(['first', 'second']);
  expect(await res.json()).toEqual({ user: 'runar' });
});

test('onRequest hook can short-circuit with a Response', async () => {
  const handler = makeRoute({
    onRequest: [() => new Response('intercepted', { status: 418 })],
  });
  const res = await handler(new Request('http://localhost/x'));
  expect(res.status).toBe(418);
  expect(await res.text()).toBe('intercepted');
});

test('thrown HttpError maps to its status; unknown errors map to 500', async () => {
  const notFound = await makeRoute({ handlerName: 'missing' })(
    new Request('http://localhost/x')
  );
  expect(notFound.status).toBe(404);
  expect(await notFound.json()).toEqual({
    statusCode: 404,
    error: 'Not Found',
    message: 'nope',
  });

  const crashed = await makeRoute({ handlerName: 'boom' })(
    new Request('http://localhost/x')
  );
  expect(crashed.status).toBe(500);
});

test('onError hook sees the error and can override the response', async () => {
  let seen: unknown;
  const handler = makeRoute({
    handlerName: 'boom',
    onError: [
      (err) => {
        seen = err;
        return Response.json({ custom: true }, { status: 599 });
      },
    ],
  });
  const res = await handler(new Request('http://localhost/x'));
  expect(res.status).toBe(599);
  expect((seen as Error).message).toBe('kaboom');
});
