import { HttpException, HttpStatus } from '@nestjs/common';
import { PlatformError } from '../../platforms/platform.errors';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { CommentNotFoundException } from './domain.exception';

function capture(exception: unknown): { status: number; body: Record<string, unknown> } {
  let status = 0;
  let body: Record<string, unknown> = {};

  const response = {
    status: (code: number) => {
      status = code;
      return response;
    },
    type: () => response,
    json: (payload: Record<string, unknown>) => {
      body = payload;
      return response;
    },
  };

  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ url: '/v1/comments/c-1', method: 'GET' }),
      getResponse: () => response,
    }),
  };

  new AllExceptionsFilter().catch(exception, host as never);
  return { status, body };
}

describe('AllExceptionsFilter', () => {
  it('maps a platform failure to 502 and a timeout to 504, never 500', () => {
    const unavailable = capture(
      new PlatformError({ code: 'UNAVAILABLE', platform: 'x', message: '503' }),
    );
    const timeout = capture(new PlatformError({ code: 'TIMEOUT', platform: 'x', message: 'slow' }));

    // The caller's request was fine — 5xx alerting on our own errors stays meaningful.
    expect(unavailable.status).toBe(HttpStatus.BAD_GATEWAY);
    expect(timeout.status).toBe(HttpStatus.GATEWAY_TIMEOUT);
    expect(unavailable.body).toMatchObject({ code: 'platform_unavailable', platform: 'x' });
  });

  it('preserves a domain exception’s status and stable code', () => {
    const { status, body } = capture(new CommentNotFoundException('c-1'));

    expect(status).toBe(HttpStatus.NOT_FOUND);
    expect(body.code).toBe('comment_not_found');
    expect(body.instance).toBe('/v1/comments/c-1');
  });

  it('never leaks internals from an unexpected error', () => {
    const { status, body } = capture(new Error('connection string user:password@host'));

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.code).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('password');
  });

  it('passes a framework HttpException through with its own status', () => {
    const { status, body } = capture(new HttpException('Bad Request', HttpStatus.BAD_REQUEST));

    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.code).toBe('request_invalid');
  });
});
