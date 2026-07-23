import { expect, test } from 'bun:test'
import { buildMatcher, type MatcherEntry } from '../src/router/matcher'
import type { CompiledHandler } from '../src/router/compile-route'

const h: CompiledHandler = async () => new Response(null)

function entries(...paths: string[]): MatcherEntry[] {
  return paths.map((path) => ({ path, handlers: { GET: h } }))
}

test('exact match wins over param match', () => {
  const match = buildMatcher(entries('/users/:id', '/users/me'))
  expect(match('/users/me')!.params).toEqual({})
  expect(match('/users/42')!.params).toEqual({ id: '42' })
})

test('multiple params are extracted', () => {
  const match = buildMatcher(entries('/teams/:teamId/members/:userId'))
  expect(match('/teams/7/members/9')!.params).toEqual({ teamId: '7', userId: '9' })
})

test('no match returns null', () => {
  const match = buildMatcher(entries('/users'))
  expect(match('/nope')).toBeNull()
  expect(match('/users/too/deep')).toBeNull()
})

test('root path matches', () => {
  const match = buildMatcher(entries('/'))
  expect(match('/')).not.toBeNull()
})

test('empty request-path segments never match (mirrors Bun.serve)', () => {
  const match = buildMatcher(entries('/users', '/users/:id'))
  expect(match('/users/')).toBeNull()
  expect(match('//users')).toBeNull()
  expect(match('/users//1')).toBeNull()
})

test('static segment beats param at the same position, regardless of registration order', () => {
  const match = buildMatcher(entries('/a/:b/c', '/a/x/:y'))
  expect(match('/a/x/c')!.params).toEqual({ y: 'c' })
  expect(match('/a/q/c')!.params).toEqual({ b: 'q' })
})
