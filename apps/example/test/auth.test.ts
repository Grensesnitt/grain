import { beforeAll, expect, test } from 'bun:test';
import { SignJWT } from 'jose';
import { buildApp } from '../src/app';
import type { Grain } from '@grensesnitt/grain';

let app: Grain;

beforeAll(() => {
  process.env.API_TOKEN = 'test-token';
  process.env.JWT_SECRET = 'test-jwt-secret';
  app = buildApp();
});

const json = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });

const get = (path: string, headers: Record<string, string> = {}) =>
  app.handle(new Request(`http://localhost${path}`, { headers }));

const register = async (email: string) => {
  const res = await app.handle(
    json(
      '/users',
      { name: 'Test', email, password: 'super-secret-8' },
      { 'x-api-token': 'test-token' }
    )
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: number; name: string; email: string };
};

const login = async (email: string, password = 'super-secret-8') => {
  const res = await app.handle(json('/auth/login', { email, password }));
  return res;
};

test('register → login → me returns the same public user', async () => {
  const created = await register('login@x.no');
  const loginRes = await login('login@x.no');
  expect(loginRes.status).toBe(200);
  const { token } = (await loginRes.json()) as { token: string };
  expect(token.split('.')).toHaveLength(3);
  const me = await get('/auth/me', { authorization: `Bearer ${token}` });
  expect(me.status).toBe(200);
  expect(await me.json()).toEqual({
    id: created.id,
    name: 'Test',
    email: 'login@x.no',
  });
});

test('wrong password and unknown email return identical 401 bodies', async () => {
  await register('same401@x.no');
  const wrongPw = await login('same401@x.no', 'wrong-password');
  const unknown = await login('nobody@x.no');
  expect(wrongPw.status).toBe(401);
  expect(unknown.status).toBe(401);
  expect(await wrongPw.json()).toEqual(await unknown.json());
});

test('tampered and expired tokens are rejected', async () => {
  await register('tamper@x.no');
  const { token } = (await (await login('tamper@x.no')).json()) as {
    token: string;
  };
  const tampered = `${token.slice(0, -2)}xx`;
  expect(
    (await get('/auth/me', { authorization: `Bearer ${tampered}` })).status
  ).toBe(401);

  const now = Math.floor(Date.now() / 1000);
  const expired = await new SignJWT({ email: 'tamper@x.no' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('1')
    .setIssuedAt(now - 7200)
    .setExpirationTime(now - 3600)
    .sign(new TextEncoder().encode('test-jwt-secret'));
  expect(
    (await get('/auth/me', { authorization: `Bearer ${expired}` })).status
  ).toBe(401);
});

test('missing or malformed auth header on /auth/me → 401', async () => {
  expect((await get('/auth/me')).status).toBe(401);
  expect((await get('/auth/me', { authorization: 'Token abc' })).status).toBe(
    401
  );
});

test('a valid token for a deleted user is rejected', async () => {
  const created = await register('gone@x.no');
  const { token } = (await (await login('gone@x.no')).json()) as {
    token: string;
  };
  const del = await app.handle(
    new Request(`http://localhost/users/${created.id}`, {
      method: 'DELETE',
      headers: { 'x-api-token': 'test-token' },
    })
  );
  expect(del.status).toBe(204);
  expect(
    (await get('/auth/me', { authorization: `Bearer ${token}` })).status
  ).toBe(401);
});

test('no user-returning response contains password material', async () => {
  const created = await register('leak@x.no');
  const { token } = (await (await login('leak@x.no')).json()) as {
    token: string;
  };
  const bodies = [
    created,
    await (await get('/users')).json(),
    await (await get(`/users/${created.id}`)).json(),
    await (await get('/auth/me', { authorization: `Bearer ${token}` })).json(),
  ];
  for (const body of bodies) {
    const text = JSON.stringify(body).toLowerCase();
    expect(text).not.toContain('password');
    expect(text).not.toContain('hash');
  }
});

test('login with JWT_SECRET unset is a loud 500', async () => {
  await register('cfg@x.no');
  const saved = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    const res = await login('cfg@x.no');
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe(
      'Internal Server Error'
    );
  } finally {
    process.env.JWT_SECRET = saved;
  }
});
