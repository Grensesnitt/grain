import { buildApp } from './app';

const port = Number(process.env.PORT ?? 3000);
const server = await buildApp().listen(port);
console.log(`example app listening on http://localhost:${server.port}`);
