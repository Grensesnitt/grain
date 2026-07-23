import { beforeAll, expect, test } from 'bun:test'
import { buildApp } from '../src/app'
import type { Grain } from '@grensesnitt/grain'

let app: Grain
beforeAll(() => {
  process.env.API_TOKEN = 'test-token'
  app = buildApp()
})

const jsonPost = (path: string, body: unknown, token?: string) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
  })

test('health endpoint is open', async () => {
  const res = await app.handle(new Request('http://localhost/health'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok' })
})

test('full CRUD flow', async () => {
  const created = await app.handle(
    jsonPost('/users', { name: 'Runar', email: 'runar@grensesnitt.no' }, 'test-token'),
  )
  expect(created.status).toBe(201)
  const user = await created.json() as { id: number; name: string }
  expect(user.name).toBe('Runar')

  const list = await app.handle(new Request('http://localhost/users'))
  expect((await list.json() as unknown[]).length).toBe(1)

  const one = await app.handle(new Request(`http://localhost/users/${user.id}`))
  expect(one.status).toBe(200)

  const gone = await app.handle(
    new Request(`http://localhost/users/${user.id}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer test-token' },
    }),
  )
  expect(gone.status).toBe(204)

  const missing = await app.handle(new Request(`http://localhost/users/${user.id}`))
  expect(missing.status).toBe(404)
})

test('validation failures are 400 with details', async () => {
  const res = await app.handle(jsonPost('/users', { name: '', email: 'not-an-email' }, 'test-token'))
  expect(res.status).toBe(400)
  const body = await res.json() as { error: string; details: Array<{ path: string }> }
  expect(body.error).toBe('Validation Failed')
  expect(body.details.map((d) => d.path)).toEqual(
    expect.arrayContaining(['/name', '/email']),
  )
})

test('mutating routes require a bearer token', async () => {
  const noToken = await app.handle(jsonPost('/users', { name: 'X', email: 'x@x.no' }))
  expect(noToken.status).toBe(401)
  const wrongToken = await app.handle(jsonPost('/users', { name: 'X', email: 'x@x.no' }, 'wrong'))
  expect(wrongToken.status).toBe(401)
})

test('unknown id is a 404 with the standard shape', async () => {
  const res = await app.handle(new Request('http://localhost/users/9999'))
  expect(res.status).toBe(404)
  const body = await res.json() as { statusCode: number; error: string }
  expect(body).toMatchObject({ statusCode: 404, error: 'Not Found' })
})
