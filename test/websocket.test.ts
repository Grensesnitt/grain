import { afterAll, describe, expect, test } from 'bun:test';
import {
  Ctx,
  Gateway,
  Grain,
  Injectable,
  UnauthorizedError,
  t,
  type Guard,
  type WsClient,
  type WsGateway,
} from '../src';
import { UseGuard } from '../src';

const Envelope = t.Object(
  { event: t.String(), data: t.Optional(t.Unknown()) },
  { additionalProperties: false }
);

@Injectable()
class TokenGuard implements Guard {
  canActivate(ctx: Ctx): boolean {
    if (ctx.query.token !== 'good') throw new UnauthorizedError();
    ctx.store.user = { name: 'alice' };
    return true;
  }
}

@Gateway('/ws', { message: Envelope })
@UseGuard(TokenGuard)
class EchoGateway implements WsGateway<{ event: string; data?: unknown }> {
  open(client: WsClient) {
    client.send({
      event: 'hello',
      data: { id: client.id, user: client.ctx.store.user },
    });
  }

  message(client: WsClient, message: { event: string; data?: unknown }) {
    client.send({ event: 'echo', data: message });
  }
}

const app = new Grain({ controllers: [], gateways: [EchoGateway] });
const server = app.listen({ port: 0, hostname: '127.0.0.1' });
afterAll(() => app.stop());

function connect(
  query: string
): Promise<{ ws: WebSocket; next: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws${query}`);
    const queue: any[] = [];
    const waiters: ((m: any) => void)[] = [];
    ws.onmessage = (e) => {
      const parsed = JSON.parse(String(e.data));
      const waiter = waiters.shift();
      if (waiter) waiter(parsed);
      else queue.push(parsed);
    };
    const next = () =>
      new Promise<any>((res) => {
        if (queue.length) res(queue.shift());
        else waiters.push(res);
      });
    ws.onopen = () => resolve({ ws, next });
    ws.onerror = () => reject(new Error('connect failed'));
  });
}

describe('websocket gateways', () => {
  test('guard rejects bad token before upgrade', async () => {
    await expect(connect('?token=bad')).rejects.toThrow();
    const res = await fetch(`http://127.0.0.1:${server.port}/ws?token=bad`);
    expect(res.status).toBe(401);
  });

  test('open runs with guard-populated ctx.store and a client id', async () => {
    const { ws, next } = await connect('?token=good');
    const hello = await next();
    expect(hello.event).toBe('hello');
    expect(typeof hello.data.id).toBe('string');
    expect(hello.data.user).toEqual({ name: 'alice' });
    ws.close();
  });

  test('valid messages are dispatched, invalid ones get a validation error reply', async () => {
    const { ws, next } = await connect('?token=good');
    await next(); // hello
    ws.send(JSON.stringify({ event: 'ping', data: 1 }));
    expect(await next()).toEqual({
      event: 'echo',
      data: { event: 'ping', data: 1 },
    });
    ws.send(JSON.stringify({ nope: true }));
    const err = await next();
    expect(err.statusCode).toBe(400);
    expect(err.error).toBe('Validation Failed');
    ws.send('not json');
    expect((await next()).statusCode).toBe(400);
    ws.close();
  });

  test('handle() without a live server returns 426 for the ws path', async () => {
    const offline = new Grain({ controllers: [], gateways: [EchoGateway] });
    const res = await offline.handle(new Request('http://x/ws?token=good'));
    expect(res.status).toBe(426);
  });
});
