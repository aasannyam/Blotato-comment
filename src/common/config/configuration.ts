export const DEFAULT_DATABASE_URL = 'postgres://blotato:blotato@localhost:55432/blotato_comments';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  workers: { enabled: boolean };
  reply: { maxAttempts: number; dispatchBatchSize: number };
  sync: { pollBatchSize: number };
  comments: { staleAfterSeconds: number };
  platforms: { fakeEnabled: boolean };
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default (): AppConfig => ({
  port: int(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  workers: {
    // Lets API and worker instances run the same image in different roles.
    enabled: process.env.WORKERS_ENABLED !== 'false',
  },
  reply: {
    maxAttempts: int(process.env.REPLY_MAX_ATTEMPTS, 6),
    dispatchBatchSize: int(process.env.REPLY_DISPATCH_BATCH_SIZE, 25),
  },
  sync: { pollBatchSize: int(process.env.SYNC_POLL_BATCH_SIZE, 20) },
  comments: { staleAfterSeconds: int(process.env.COMMENT_STALE_AFTER_SECONDS, 120) },
  platforms: {
    // Opt-in, and never on in production even if the flag is set by accident.
    fakeEnabled: process.env.ENABLE_FAKE_PLATFORM === 'true' && process.env.NODE_ENV !== 'production',
  },
});
