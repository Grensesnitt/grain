import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import {
  Controller,
  Get,
  Grain,
  Logger,
  Public,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@grensesnitt/grain';
import { Injectable } from '../src/di/injectable';

describe('lifecycle hooks', () => {
  test('onModuleInit runs once before the first request, dependencies first', async () => {
    const calls: string[] = [];

    @Injectable()
    class Dep implements OnModuleInit {
      async onModuleInit() {
        calls.push('dep');
      }
    }

    @Injectable()
    class Svc implements OnModuleInit {
      constructor(readonly dep: Dep) {}
      onModuleInit() {
        calls.push('svc');
      }
    }

    @Controller('/l')
    @Public()
    class LController {
      constructor(readonly svc: Svc) {}
      @Get('/')
      go() {
        return { calls };
      }
    }

    const app = new Grain({ controllers: [LController] });
    const res = await app.handle(new Request('http://x/l'));
    expect(await res.json()).toEqual({ calls: ['dep', 'svc'] });
    await app.handle(new Request('http://x/l'));
    expect(calls).toEqual(['dep', 'svc']); // memoized — not re-run
  });

  test('a registered but never-injected provider is instantiated and hooked', async () => {
    let started = false;

    @Injectable()
    class Worker implements OnModuleInit {
      onModuleInit() {
        started = true;
      }
    }

    @Controller('/w')
    @Public()
    class WController {
      @Get('/')
      go() {
        return { started };
      }
    }

    const app = new Grain({ controllers: [WController], providers: [Worker] });
    const res = await app.handle(new Request('http://x/w'));
    expect(await res.json()).toEqual({ started: true });
  });

  test('shutdown runs onModuleDestroy in reverse creation order, once, logging hook errors', async () => {
    const calls: string[] = [];

    @Injectable()
    class Dep implements OnModuleDestroy {
      onModuleDestroy() {
        calls.push('dep');
      }
    }

    @Injectable()
    class Svc implements OnModuleDestroy {
      constructor(readonly dep: Dep) {}
      async onModuleDestroy() {
        calls.push('svc');
        throw new Error('destroy failure');
      }
    }

    @Controller('/s')
    @Public()
    class SController {
      constructor(readonly svc: Svc) {}
      @Get('/')
      go() {
        return {};
      }
    }

    const lines: string[] = [];
    const app = new Grain({
      controllers: [SController],
      logger: new Logger({ write: (line) => lines.push(line) }),
    });
    await app.handle(new Request('http://x/s'));
    await app.shutdown();
    await app.shutdown(); // idempotent
    expect(calls).toEqual(['svc', 'dep']); // dependents destroyed first
    expect(lines.some((l) => l.includes('onModuleDestroy failed'))).toBe(true);
  });

  test('useValue instances participate via duck typing', async () => {
    const calls: string[] = [];
    class External {
      onModuleDestroy() {
        calls.push('external');
      }
    }

    @Controller('/v')
    @Public()
    class VController {
      constructor(readonly ext: External) {}
      @Get('/')
      go() {
        return {};
      }
    }

    const app = new Grain({
      controllers: [VController],
      providers: [{ provide: External, useValue: new External() }],
    });
    await app.handle(new Request('http://x/v'));
    await app.shutdown();
    expect(calls).toEqual(['external']);
  });
});
