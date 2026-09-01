import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { Controller, Get, Grain, Logger, Public } from '@grensesnitt/grain';
import { Injectable } from '../src/di/injectable';

function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

describe('Logger', () => {
  test('writes JSON lines with level, time, msg and fields', () => {
    const { lines, write } = capture();
    new Logger({ write }).info('hello', { a: 1 });
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({ level: 'info', msg: 'hello', a: 1 });
    expect(new Date(parsed.time).getTime()).toBeGreaterThan(0);
  });

  test('filters below the configured level', () => {
    const { lines, write } = capture();
    const logger = new Logger({ level: 'warn', write });
    logger.debug('nope');
    logger.info('nope');
    logger.warn('yes');
    logger.error('yes');
    expect(lines).toHaveLength(2);
  });

  test('child loggers extend bindings', () => {
    const { lines, write } = capture();
    new Logger({ write, bindings: { service: 'core' } })
      .child({ module: 'email' })
      .info('sent');
    expect(JSON.parse(lines[0])).toMatchObject({
      service: 'core',
      module: 'email',
      msg: 'sent',
    });
  });

  test('serializes Error fields', () => {
    const { lines, write } = capture();
    new Logger({ write }).error('boom', { error: new Error('kaputt') });
    const parsed = JSON.parse(lines[0]);
    expect(parsed.error).toMatchObject({ name: 'Error', message: 'kaputt' });
    expect(typeof parsed.error.stack).toBe('string');
  });

  test('pretty mode writes human-readable lines', () => {
    const { lines, write } = capture();
    new Logger({ write, pretty: true }).warn('careful', { n: 2 });
    expect(lines[0]).toMatch(/^\[.+\] WARN careful \{"n":2\}$/);
  });
});

describe('request logging', () => {
  @Injectable()
  class NeedsLogger {
    constructor(readonly logger: Logger) {}
  }

  @Controller('/ping')
  @Public()
  class PingController {
    constructor(readonly svc: NeedsLogger) {}
    @Get('/')
    ping() {
      return { ok: true };
    }
  }

  test('logs method/path/status/duration with a correlation id', async () => {
    const { lines, write } = capture();
    const logger = new Logger({ write });
    const app = new Grain({ controllers: [PingController], logger });
    const res = await app.handle(new Request('http://localhost/ping'));
    expect(res.status).toBe(200);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({
      level: 'info',
      msg: 'request',
      method: 'GET',
      path: '/ping',
      status: 200,
    });
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.requestId).toBe(res.headers.get('x-request-id'));
  });

  test('propagates an incoming x-request-id', async () => {
    const { lines, write } = capture();
    const app = new Grain({
      controllers: [PingController],
      logger: new Logger({ write }),
    });
    const res = await app.handle(
      new Request('http://localhost/ping', {
        headers: { 'x-request-id': 'corr-123' },
      })
    );
    expect(res.headers.get('x-request-id')).toBe('corr-123');
    expect(JSON.parse(lines[0]).requestId).toBe('corr-123');
  });

  test('4xx logs at warn, and unknown routes are logged too', async () => {
    const { lines, write } = capture();
    const app = new Grain({
      controllers: [PingController],
      logger: new Logger({ write }),
    });
    const res = await app.handle(new Request('http://localhost/nope'));
    expect(res.status).toBe(404);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ level: 'warn', path: '/nope', status: 404 });
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  test('the logger is injectable, and a default exists without options.logger', async () => {
    const { write } = capture();
    const logger = new Logger({ write });
    const app = new Grain({ controllers: [PingController], logger });
    await app.handle(new Request('http://localhost/ping'));
    // The DI-resolved instance is the one passed in GrainOptions.
    const resolved = app['container'].resolve(NeedsLogger) as NeedsLogger;
    expect(resolved.logger).toBe(logger);

    // Without options.logger the graph still wires (a default is registered).
    const fallback = new Grain({ controllers: [PingController] });
    const res = await fallback.handle(new Request('http://localhost/ping'));
    expect(res.status).toBe(200);
  });
});
