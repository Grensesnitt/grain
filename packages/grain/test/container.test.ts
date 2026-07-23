import 'reflect-metadata'
import { expect, test } from 'bun:test'
import { Injectable } from '../src/di/injectable'
import { Container } from '../src/di/container'

@Injectable()
class Leaf {
  value = 'leaf'
}

@Injectable()
class Mid {
  constructor(readonly leaf: Leaf) {}
}

@Injectable()
class Top {
  constructor(readonly mid: Mid, readonly leaf: Leaf) {}
}

test('resolves a class with no dependencies', () => {
  const c = new Container()
  expect(c.resolve(Leaf).value).toBe('leaf')
})

test('emitDecoratorMetadata works: nested constructor injection resolves real instances', () => {
  const c = new Container()
  const top = c.resolve(Top)
  expect(top.mid).toBeInstanceOf(Mid)
  expect(top.mid.leaf).toBeInstanceOf(Leaf)
})

test('everything is a singleton', () => {
  const c = new Container()
  const top = c.resolve(Top)
  expect(c.resolve(Top)).toBe(top)
  expect(top.leaf).toBe(top.mid.leaf)
})

test('unmarked classes are rejected with a clear error', () => {
  class Plain {}
  const c = new Container()
  expect(() => c.resolve(Plain)).toThrow(
    'Cannot resolve Plain: class is not marked with @Injectable() or @Controller()',
  )
})

test('circular dependencies throw at resolve time with the full chain', () => {
  @Injectable()
  class A { constructor(_b: unknown) {} }
  @Injectable()
  class B { constructor(_a: unknown) {} }
  // Simulate what a circular import produces: A needs B, B needs A.
  Reflect.defineMetadata('design:paramtypes', [B], A)
  Reflect.defineMetadata('design:paramtypes', [A], B)
  const c = new Container()
  expect(() => c.resolve(A)).toThrow('Circular dependency detected: A → B → A')
})

test('non-class constructor params throw a clear error', () => {
  @Injectable()
  class NeedsString {
    constructor(readonly name: string) {}
  }
  const c = new Container()
  expect(() => c.resolve(NeedsString)).toThrow(
    'Cannot inject parameter 0 of NeedsString',
  )
})
