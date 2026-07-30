import type { ServerWebSocket, WebSocketHandler } from 'bun';
import { ValidationError } from '../errors/http-error';
import type { Validator } from '../validation/compile';
import type { Ctx, WsClient, WsGateway } from '../types';

export interface WsData {
  ctx: Ctx;
  gateway: WsGateway;
  validate: Validator | null;
  client?: WsClient;
}

function makeClient(ws: ServerWebSocket<WsData>): WsClient {
  return {
    id: crypto.randomUUID(),
    ctx: ws.data.ctx,
    send: (data) => void ws.send(JSON.stringify(data)),
    close: (code, reason) => ws.close(code, reason),
  };
}

export function websocketHandler(): WebSocketHandler<WsData> {
  return {
    open(ws) {
      ws.data.client = makeClient(ws);
      void ws.data.gateway.open?.(ws.data.client);
    },
    async message(ws, raw) {
      const client = ws.data.client!;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        client.send({
          statusCode: 400,
          error: 'Validation Failed',
          message: 'Invalid JSON message',
        });
        return;
      }
      if (ws.data.validate) {
        try {
          parsed = ws.data.validate(parsed);
        } catch (err) {
          if (err instanceof ValidationError) {
            client.send({
              statusCode: 400,
              error: 'Validation Failed',
              message: err.message,
              details: err.details,
            });
            return;
          }
          throw err;
        }
      }
      await ws.data.gateway.message?.(client, parsed);
    },
    close(ws) {
      if (ws.data.client) void ws.data.gateway.close?.(ws.data.client);
    },
  };
}
