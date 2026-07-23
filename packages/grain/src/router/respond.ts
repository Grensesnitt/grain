export function toResponse(result: unknown, httpCode?: number): Response {
  if (result instanceof Response) return result
  if (result === undefined) return new Response(null, { status: httpCode ?? 204 })
  return Response.json(result, { status: httpCode ?? 200 })
}
