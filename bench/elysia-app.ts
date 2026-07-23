import { Elysia } from 'elysia';

new Elysia()
  .get('/ping', () => ({ pong: true }))
  .listen(Number(process.env.PORT));
