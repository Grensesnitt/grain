Bun.serve({
  port: Number(process.env.PORT),
  routes: { '/ping': { GET: () => Response.json({ pong: true }) } },
  fetch: () => new Response(null, { status: 404 }),
})
