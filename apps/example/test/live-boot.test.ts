import { expect, test } from 'bun:test';

// Regression: Bun resolves tsconfig relative to the working directory, so
// running from the package dir (bun run start) without a package-local
// tsconfig silently drops emitDecoratorMetadata — DI constructs controllers
// with zero args and every injected route 500s while /health stays green.
test('app boots with working DI when started from the package directory', async () => {
  const proc = Bun.spawn(['bun', 'src/main.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, API_TOKEN: 'live-test', PORT: '3341' },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  try {
    let healthy = false;
    for (let i = 0; i < 50 && !healthy; i++) {
      try {
        healthy = (await fetch('http://localhost:3341/health')).ok;
      } catch {
        await Bun.sleep(50);
      }
    }
    expect(healthy).toBe(true);
    const res = await fetch('http://localhost:3341/users');
    expect(res.status).toBe(200);
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test('serves OpenAPI docs and an echo websocket', async () => {
  const port = '3342';
  const baseUrl = `http://localhost:${port}`;
  const proc = Bun.spawn(['bun', 'src/main.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, API_TOKEN: 'live-test', PORT: port },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  try {
    let healthy = false;
    for (let i = 0; i < 50 && !healthy; i++) {
      try {
        healthy = (await fetch(`${baseUrl}/health`)).ok;
      } catch {
        await Bun.sleep(50);
      }
    }
    expect(healthy).toBe(true);

    const json = await fetch(`${baseUrl}/docs/json`);
    expect(json.status).toBe(200);
    const doc = (await json.json()) as any;
    expect(doc.info.title).toBe('Grain Example');

    const echoed = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/echo`);
      ws.onmessage = (e) => (resolve(JSON.parse(String(e.data))), ws.close());
      ws.onopen = () => ws.send(JSON.stringify({ event: 'ping' }));
      ws.onerror = () => reject(new Error('ws failed'));
    });
    expect(echoed).toEqual({ event: 'ping' });
  } finally {
    proc.kill();
    await proc.exited;
  }
});
