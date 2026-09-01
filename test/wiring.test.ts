import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import {
  Config,
  ConfigError,
  Controller,
  Get,
  Grain,
  Public,
  t,
  WiringError,
} from '@grensesnitt/grain';
import { Injectable } from '../src/di/injectable';
import { Container } from '../src/di/container';

// Simulates what `import type` produces at runtime: the param slot in
// design:paramtypes collapses to Object.
function collapseParam(target: object, params: unknown[]): void {
  Reflect.defineMetadata('design:paramtypes', params, target);
}

describe('boot-time DI diagnostics', () => {
  test('import-type collapse aggregates across the whole graph with the hint', async () => {
    @Injectable()
    class BrokenA {
      constructor(_dep: unknown) {}
    }
    @Injectable()
    class BrokenB {
      constructor(_dep: unknown) {}
    }
    collapseParam(BrokenA, [Object]);
    collapseParam(BrokenB, [Object]);

    @Controller('/a')
    @Public()
    class AController {
      constructor(readonly a: BrokenA) {}
      @Get('/')
      go() {
        return {};
      }
    }
    @Controller('/b')
    @Public()
    class BController {
      constructor(readonly b: BrokenB) {}
      @Get('/')
      go() {
        return {};
      }
    }

    const app = new Grain({ controllers: [AController, BController] });
    let caught: unknown;
    try {
      await app.handle(new Request('http://localhost/a'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WiringError);
    const err = caught as WiringError;
    expect(err.issues).toHaveLength(2);
    expect(err.message).toContain('BrokenA parameter 0');
    expect(err.message).toContain('BrokenB parameter 0');
    expect(err.message).toContain("imported with 'import type'");
  });

  test('undefined param types and missing @Injectable are diagnosed too', async () => {
    @Injectable()
    class CircularVictim {
      constructor(_dep: unknown) {}
    }
    collapseParam(CircularVictim, [undefined]);

    class NotDecorated {}

    @Controller('/c')
    @Public()
    class CController {
      constructor(
        readonly v: CircularVictim,
        readonly n: NotDecorated
      ) {}
      @Get('/')
      go() {
        return {};
      }
    }

    const app = new Grain({ controllers: [CController] });
    let caught: unknown;
    try {
      await app.handle(new Request('http://localhost/c'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WiringError);
    const message = (caught as WiringError).message;
    expect(message).toContain(
      'CircularVictim parameter 0: type is undefined — usually a circular file import'
    );
    expect(message).toContain(
      'NotDecorated is not marked with @Injectable() or @Controller()'
    );
  });

  test('wiring issues are reported before config issues', async () => {
    class SomeConfig extends Config(t.Object({ MISSING_VAR: t.String() })) {}

    @Injectable()
    class Broken {
      constructor(
        readonly config: SomeConfig,
        _dep: unknown
      ) {}
    }
    collapseParam(Broken, [SomeConfig, Object]);

    @Controller('/d')
    @Public()
    class DController {
      constructor(readonly broken: Broken) {}
      @Get('/')
      go() {
        return {};
      }
    }

    const app = new Grain({ controllers: [DController], env: {} });
    let caught: unknown;
    try {
      await app.handle(new Request('http://localhost/d'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WiringError);
    expect(caught).not.toBeInstanceOf(ConfigError);
  });

  test('resolve() outside a preflight still throws WiringError for a bad slot', () => {
    @Injectable()
    class LateBroken {
      constructor(_dep: unknown) {}
    }
    collapseParam(LateBroken, [Object]);
    const c = new Container();
    let caught: unknown;
    try {
      c.resolve(LateBroken);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WiringError);
    expect((caught as WiringError).issues).toHaveLength(1);
  });
});
