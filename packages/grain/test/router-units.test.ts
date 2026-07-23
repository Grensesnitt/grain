import { expect, test } from 'bun:test';
import { createCtx } from '../src/router/context';
import { toResponse } from '../src/router/respond';
import { buildExtractors } from '../src/router/extractors';
import type { ParamMeta } from '../src/decorators/metadata';

test('createCtx picks up Bun route params and lazily parses query', () => {
  const req = new Request('http://localhost/things?page=2&active=true');
  (req as any).params = { id: '7' };
  const ctx = createCtx(req);
  expect(ctx.params).toEqual({ id: '7' });
  expect(ctx.query).toEqual({ page: '2', active: 'true' });
  expect(ctx.store).toEqual({});
  expect(ctx.body).toBeUndefined();
});

test('ctx.query is assignable (validators replace it with converted values)', () => {
  const ctx = createCtx(new Request('http://localhost/?page=2'));
  ctx.query = { page: 2 };
  expect(ctx.query).toEqual({ page: 2 });
});

test('ctx without route params defaults to empty object', () => {
  const ctx = createCtx(new Request('http://localhost/'));
  expect(ctx.params).toEqual({});
});

test('toResponse: object becomes JSON 200', async () => {
  const res = toResponse({ ok: true });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/json');
  expect(await res.json()).toEqual({ ok: true });
});

test('toResponse: httpCode overrides status', () => {
  expect(toResponse({ ok: true }, 201).status).toBe(201);
});

test('toResponse: undefined becomes empty 204', async () => {
  const res = toResponse(undefined);
  expect(res.status).toBe(204);
  expect(await res.text()).toBe('');
});

test('toResponse: a Response instance passes through untouched', () => {
  const raw = new Response('raw', { status: 418 });
  expect(toResponse(raw)).toBe(raw);
});

test('extractors bind by kind, name and index; undecorated positions are undefined', () => {
  const metas: ParamMeta[] = [
    { index: 0, kind: 'param', name: 'id' },
    { index: 2, kind: 'query' },
    { index: 3, kind: 'body' },
    { index: 4, kind: 'ctx' },
  ];
  const ctx = createCtx(new Request('http://localhost/'));
  ctx.params = { id: 7 };
  ctx.query = { page: 2 };
  ctx.body = { name: 'x' };
  const ex = buildExtractors(metas, 5);
  expect(ex.map((f) => f(ctx))).toEqual([
    7,
    undefined,
    { page: 2 },
    { name: 'x' },
    ctx,
  ]);
});

test('extractors: whole params object when @Param has no name', () => {
  const ctx = createCtx(new Request('http://localhost/'));
  ctx.params = { id: 1, slug: 'a' };
  const [ex] = buildExtractors([{ index: 0, kind: 'param' }], 1);
  expect(ex!(ctx)).toEqual({ id: 1, slug: 'a' });
});
