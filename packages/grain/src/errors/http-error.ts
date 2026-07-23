const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  500: 'Internal Server Error',
}

export class HttpError extends Error {
  readonly error: string

  constructor(
    readonly statusCode: number,
    message?: string,
    readonly details?: unknown,
    error?: string,
  ) {
    const label = error ?? STATUS_TEXT[statusCode] ?? 'Error'
    super(message ?? label)
    this.name = new.target.name
    this.error = label
  }
}

export class BadRequestError extends HttpError {
  constructor(message?: string, details?: unknown) { super(400, message, details) }
}
export class UnauthorizedError extends HttpError {
  constructor(message?: string, details?: unknown) { super(401, message, details) }
}
export class ForbiddenError extends HttpError {
  constructor(message?: string, details?: unknown) { super(403, message, details) }
}
export class NotFoundError extends HttpError {
  constructor(message?: string, details?: unknown) { super(404, message, details) }
}
export class ConflictError extends HttpError {
  constructor(message?: string, details?: unknown) { super(409, message, details) }
}
export class ValidationError extends HttpError {
  constructor(message: string, details: unknown) { super(400, message, details, 'Validation Failed') }
}
