/** Matches docker-compose.yml, which publishes on 55432 to avoid shadowing a
 *  locally installed Postgres on 5432. */
export const DEFAULT_DATABASE_URL = 'postgres://blotato:blotato@localhost:55432/blotato_comments';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  workers: { enabled: boolean };
  reply: { maxAttempts: number; dispatchBatchSize: number };
  sync: { pollBatchSize: number };
  comments: { staleAfterSeconds: number };
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default (): AppConfig => ({
  port: int(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  workers: {
    // Lets API and worker instances run the same image in different roles, so
    // scaling reads does not multiply polling load on the platforms.
    enabled: process.env.WORKERS_ENABLED !== 'false',
  },
  reply: {
    maxAttempts: int(process.env.REPLY_MAX_ATTEMPTS, 6),
    dispatchBatchSize: int(process.env.REPLY_DISPATCH_BATCH_SIZE, 25),
  },
  sync: { pollBatchSize: int(process.env.SYNC_POLL_BATCH_SIZE, 20) },
  comments: { staleAfterSeconds: int(process.env.COMMENT_STALE_AFTER_SECONDS, 120) },
});
