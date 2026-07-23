export {}; // top-level await requires this file to be a module (it has no other import/export)

const TARGETS = [
  { name: 'raw Bun.serve', file: 'bench/raw.ts', port: 4101 },
  { name: 'grain', file: 'bench/grain-app.ts', port: 4102 },
  { name: 'elysia', file: 'bench/elysia-app.ts', port: 4103 },
];

const WARMUP = 2_000;
const DURATION_MS = 3_000;
const CONCURRENCY = 64;

async function waitReady(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* server not ready yet — keep polling */
    }
    await Bun.sleep(50);
  }
  throw new Error(`server at ${url} never became ready`);
}

async function measure(url: string): Promise<number> {
  for (let i = 0; i < WARMUP; i++) await fetch(url);
  let done = 0;
  let running = true;
  const worker = async () => {
    while (running) {
      await fetch(url);
      done++;
    }
  };
  const workers = Array.from({ length: CONCURRENCY }, worker);
  await Bun.sleep(DURATION_MS);
  running = false;
  await Promise.all(workers);
  return Math.round(done / (DURATION_MS / 1000));
}

for (const target of TARGETS) {
  const proc = Bun.spawn(['bun', target.file], {
    env: { ...process.env, PORT: String(target.port) },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  try {
    const url = `http://localhost:${target.port}/ping`;
    await waitReady(url);
    const rps = await measure(url);
    console.log(`${target.name.padEnd(14)} ${rps} req/s`);
  } finally {
    // kill even when waitReady/measure throws — never orphan a server
    proc.kill();
    await proc.exited;
  }
}
