import { PlatformError, PlatformErrorCode } from './platform.errors';

function error(code: PlatformErrorCode, retryAfterMs?: number): PlatformError {
  return new PlatformError({ code, platform: 'x', message: 'boom', retryAfterMs });
}

describe('PlatformError retryability', () => {
  it('never retries a write the platform accepted but did not identify', () => {
    // The comment is already public; retrying posts it a second time.
    expect(error('UNCONFIRMED_WRITE').retryable).toBe(false);
  });

  it('retries only the codes that improve with time', () => {
    const retryable: PlatformErrorCode[] = ['RATE_LIMITED', 'UNAVAILABLE', 'TIMEOUT'];
    const terminal: PlatformErrorCode[] = [
      'AUTH_EXPIRED',
      'FORBIDDEN',
      'NOT_FOUND',
      'INVALID_REQUEST',
      'BODY_TOO_LONG',
    ];

    for (const code of retryable) expect(error(code).retryable).toBe(true);
    // These need a human, not another attempt.
    for (const code of terminal) expect(error(code).retryable).toBe(false);
  });

  it('carries Retry-After through so the dispatcher can honour it', () => {
    expect(error('RATE_LIMITED', 30_000).retryAfterMs).toBe(30_000);
  });
});
