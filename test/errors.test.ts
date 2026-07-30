import { expect, test } from 'bun:test';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../src/errors/http-error';
import { errorToResponse } from '../src/errors/error-response';

test('subclasses carry status, default message and error label', () => {
  const cases: Array<[HttpError, number, string]> = [
    [new BadRequestError(), 400, 'Bad Request'],
    [new UnauthorizedError(), 401, 'Unauthorized'],
    [new ForbiddenError(), 403, 'Forbidden'],
    [new NotFoundError(), 404, 'Not Found'],
    [new ConflictError(), 409, 'Conflict'],
  ];
  for (const [err, status, label] of cases) {
    expect(err.statusCode).toBe(status);
    expect(err.error).toBe(label);
    expect(err.message).toBe(label);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toBeInstanceOf(Error);
  }
});

test('custom message and details are preserved', () => {
  const err = new NotFoundError('user 42 not found', { id: 42 });
  expect(err.message).toBe('user 42 not found');
  expect(err.details).toEqual({ id: 42 });
});

test('ValidationError is a 400 with Validation Failed label', () => {
  const err = new ValidationError('body validation failed', [
    { path: '/email', message: 'bad' },
  ]);
  expect(err.statusCode).toBe(400);
  expect(err.error).toBe('Validation Failed');
});

test('errorToResponse serializes HttpError to the standard shape', async () => {
  const res = errorToResponse(
    new NotFoundError('user 42 not found', { id: 42 })
  );
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({
    statusCode: 404,
    error: 'Not Found',
    message: 'user 42 not found',
    details: { id: 42 },
  });
});

test('errorToResponse omits details when undefined', async () => {
  const res = errorToResponse(new ForbiddenError());
  expect(await res.json()).toEqual({
    statusCode: 403,
    error: 'Forbidden',
    message: 'Forbidden',
  });
});

test('unknown errors become a generic 500 without stack by default', async () => {
  const res = errorToResponse(new Error('secret internals'), false);
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({
    statusCode: 500,
    error: 'Internal Server Error',
    message: 'Internal Server Error',
  });
});

test('unknown errors include stack in details when dev=true', async () => {
  const res = errorToResponse(new Error('boom'), true);
  const body = (await res.json()) as { details?: string };
  expect(body.details).toContain('boom');
});
