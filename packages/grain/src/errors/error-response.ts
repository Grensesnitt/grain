import { HttpError } from './http-error'

export function errorToResponse(
  err: unknown,
  dev: boolean = process.env.NODE_ENV === 'development',
): Response {
  if (err instanceof HttpError) {
    return Response.json(
      {
        statusCode: err.statusCode,
        error: err.error,
        message: err.message,
        ...(err.details !== undefined && { details: err.details }),
      },
      { status: err.statusCode },
    )
  }
  console.error(err)
  const stack = dev && err instanceof Error ? err.stack : undefined
  return Response.json(
    {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal Server Error',
      ...(stack !== undefined && { details: stack }),
    },
    { status: 500 },
  )
}
