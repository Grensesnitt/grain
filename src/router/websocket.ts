import type { ServerWebSocket, WebSocketHandler } from 'bun';
import { ValidationError } from '../errors/http-error';
import type { Validator } from '../validation/compile';
import type { Ctx, WsClient, WsGateway } from '../types';
import type { Logger } from '../logging/logger';

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

export function websocketHandler(logger: Logger): WebSocketHandler<WsData> {
  return {
    async open(ws) {
      ws.data.client = makeClient(ws);
      try {
        await ws.data.gateway.open?.(ws.data.client);
      } catch (err) {
        logger.error('ws open error', { error: err });
      }
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
      try {
        await ws.data.gateway.message?.(client, parsed);
      } catch (err) {
        logger.error('ws message error', { error: err });
        client.send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
    async close(ws) {
      if (!ws.data.client) return;
      try {
        await ws.data.gateway.close?.(ws.data.client);
      } catch (err) {
        logger.error('ws close error', { error: err });
      }
    },
  };
}
