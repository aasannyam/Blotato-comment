export type PlatformErrorCode =
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'AUTH_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'BODY_TOO_LONG'
  | 'DUPLICATE'
  | 'INVALID_REQUEST'
  | 'UNCONFIRMED_WRITE'
  | 'UNKNOWN';

const RETRYABLE = new Set<PlatformErrorCode>(['RATE_LIMITED', 'UNAVAILABLE', 'TIMEOUT', 'UNKNOWN']);

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly platform: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(params: {
    code: PlatformErrorCode;
    platform: string;
    message: string;
    retryAfterMs?: number;
  }) {
    super(params.message);
    this.name = 'PlatformError';
    this.code = params.code;
    this.platform = params.platform;
    this.retryable = RETRYABLE.has(params.code);
    this.retryAfterMs = params.retryAfterMs;
  }
}
