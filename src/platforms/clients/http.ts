import { PlatformError, PlatformErrorCode } from '../platform.errors';

function mapStatus(status: number): PlatformErrorCode {
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401) return 'AUTH_EXPIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404 || status === 410) return 'NOT_FOUND';
  if (status === 409) return 'DUPLICATE';
  if (status >= 500) return 'UNAVAILABLE';
  return 'INVALID_REQUEST';
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export interface PlatformRequest {
  platform: string;
  url: string;
  token: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Every outbound platform call goes through here, so timeouts and error translation are uniform. */
export async function platformFetch<T>(req: PlatformRequest): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 10_000);

  try {
    const response = await fetch(req.url, {
      method: req.method ?? 'GET',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${req.token}`,
        accept: 'application/json',
        ...(req.body ? { 'content-type': 'application/json' } : {}),
        ...req.headers,
      },
      body: req.body ? JSON.stringify(req.body) : undefined,
    });

    if (!response.ok) {
      throw new PlatformError({
        code: mapStatus(response.status),
        platform: req.platform,
        message: `${req.method ?? 'GET'} ${new URL(req.url).pathname} -> ${response.status}`,
        retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
      });
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    // A timeout is ambiguous: the write may have applied. Hence idempotency keys.
    const timedOut = error instanceof Error && error.name === 'AbortError';
    throw new PlatformError({
      code: timedOut ? 'TIMEOUT' : 'UNAVAILABLE',
      platform: req.platform,
      message: error instanceof Error ? error.message : 'transport failure',
    });
  } finally {
    clearTimeout(timer);
  }
}
