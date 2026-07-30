import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { Injectable } from '../src/di/injectable';
import { Container } from '../src/di/container';

@Injectable()
class Leaf {
  value = 'leaf';
}

@Injectable()
class Mid {
  constructor(readonly leaf: Leaf) {}
}

@Injectable()
class Top {
  constructor(
    readonly mid: Mid,
    readonly leaf: Leaf
  ) {}
}

test('resolves a class with no dependencies', () => {
  const c = new Container();
  expect(c.resolve(Leaf).value).toBe('leaf');
});

test('emitDecoratorMetadata works: nested constructor injection resolves real instances', () => {
  const c = new Container();
  const top = c.resolve(Top);
  expect(top.mid).toBeInstanceOf(Mid);
  expect(top.mid.leaf).toBeInstanceOf(Leaf);
});

test('everything is a singleton', () => {
  const c = new Container();
  const top = c.resolve(Top);
  expect(c.resolve(Top)).toBe(top);
  expect(top.leaf).toBe(top.mid.leaf);
});

test('unmarked classes are rejected with a clear error', () => {
  class Plain {}
  const c = new Container();
  expect(() => c.resolve(Plain)).toThrow(
    'Cannot resolve Plain: class is not marked with @Injectable() or @Controller()'
  );
});

test('circular dependencies throw at resolve time with the full chain', () => {
  @Injectable()
  class A {
    constructor(_b: unknown) {}
  }
  @Injectable()
  class B {
    constructor(_a: unknown) {}
  }
  // Simulate what a circular import produces: A needs B, B needs A.
  Reflect.defineMetadata('design:paramtypes', [B], A);
  Reflect.defineMetadata('design:paramtypes', [A], B);
  const c = new Container();
  expect(() => c.resolve(A)).toThrow('Circular dependency detected: A → B → A');
});

test('non-class constructor params throw a clear error', () => {
  @Injectable()
  class NeedsString {
    constructor(readonly name: string) {}
  }
  const c = new Container();
  expect(() => c.resolve(NeedsString)).toThrow(
    'Cannot inject parameter 0 of NeedsString'
  );
});

test('an undecorated subclass of an injectable class is rejected, not silently miswired', () => {
  const c = new Container();
  class Sub extends Mid {}
  expect(() => c.resolve(Sub)).toThrow(
    'Cannot resolve Sub: class is not marked with @Injectable() or @Controller()'
  );
});

test('a decorated subclass without its own constructor resolves via inherited paramtypes', () => {
  @Injectable()
  class DecoratedSub extends Mid {}
  const c = new Container();
  expect(c.resolve(DecoratedSub).leaf).toBeInstanceOf(Leaf);
});

describe('providers', () => {
  test('useValue: resolves the exact registered instance for a class token', () => {
    class Config {
      url = 'default';
    }
    const c = new Container();
    const instance = Object.assign(new Config(), { url: 'from-provider' });
    c.register({ provide: Config, useValue: instance });
    expect(c.resolve(Config)).toBe(instance);
  });

  test('useValue: injects into dependents resolved through the container', () => {
    class Config {
      url = 'default';
    }
    @Injectable()
    class Service {
      constructor(readonly config: Config) {}
    }
    const c = new Container();
    c.register({ provide: Config, useValue: Object.assign(new Config(), { url: 'x' }) });
    expect(c.resolve(Service).config.url).toBe('x');
  });

  test('useFactory: called once, result cached', () => {
    class Token {}
    let calls = 0;
    const c = new Container();
    c.register({ provide: Token, useFactory: () => (calls++, { made: true }) });
    expect(c.resolve(Token)).toBe(c.resolve(Token));
    expect(calls).toBe(1);
  });

  test('useClass: substitute implementation under the token', () => {
    class Base {
      kind = 'base';
    }
    @Injectable()
    class Sub extends Base {
      kind = 'sub';
    }
    const c = new Container();
    c.register({ provide: Base, useClass: Sub });
    expect(c.resolve(Base).kind).toBe('sub');
  });

  test('plain Ctor provider is accepted and lazily resolvable', () => {
    @Injectable()
    class Svc {}
    const c = new Container();
    c.register(Svc);
    expect(c.resolve(Svc)).toBeInstanceOf(Svc);
  });
});
