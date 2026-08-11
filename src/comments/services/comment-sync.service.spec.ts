import { RawPlatformComment } from '../../platforms/platform-client.interface';
import { Comment } from '../entities/comment.entity';
import { CommentSyncService } from './comment-sync.service';

const CTX = {
  post: {
    id: 'post-1',
    workspaceId: 'ws-1',
    platform: 'fake',
    platformPostId: 'p-1',
    publishedAt: new Date(),
  },
  account: { id: 'acc-1', platformAccountId: 'owner', handle: 'blotato' },
  platformContext: {},
} as never;

function raw(overrides: Partial<RawPlatformComment> = {}): RawPlatformComment {
  return {
    platformCommentId: 'x-1',
    parentPlatformCommentId: null,
    body: 'hello',
    author: { platformUserId: 'u-1', handle: 'nina', displayName: 'Nina', avatarUrl: null },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    likeCount: 0,
    replyCount: 0,
    isFromOwner: false,
    permalink: null,
    raw: {},
    ...overrides,
  };
}

function buildService(known: Map<string, Comment> = new Map()) {
  const upserted: Comment[][] = [];
  const comments = {
    findByPlatformIds: jest.fn().mockResolvedValue(known),
    upsertMirrored: jest.fn(async (batch: Comment[]) => {
      upserted.push(batch);
    }),
    create: jest.fn((data: Partial<Comment>) => data as Comment),
  };
  const authors = {
    ensureMany: jest.fn(async (input: { platform: string; platformUserId: string }[]) => {
      const map = new Map<string, { id: string }>();
      for (const a of input) map.set(`${a.platform}:${a.platformUserId}`, { id: `author-${a.platformUserId}` });
      return map;
    }),
  };

  const service = new CommentSyncService(
    { capabilities: () => ({ supportsWebhooks: false }) } as never,
    comments as never,
    authors as never,
    {} as never,
  );

  return { service, comments, upserted };
}

describe('CommentSyncService.ingest', () => {
  it('assigns depth, root and path from the parent already in view', async () => {
    const { service, upserted } = buildService();

    await service.ingest(CTX, [
      raw({ platformCommentId: 'x-1' }),
      raw({
        platformCommentId: 'x-2',
        parentPlatformCommentId: 'x-1',
        createdAt: new Date('2026-01-01T00:01:00Z'),
      }),
    ]);

    const [parent, child] = upserted[0];
    expect(parent.depth).toBe(0);
    expect(parent.rootId).toBe(parent.id);
    expect(child.depth).toBe(1);
    expect(child.parentId).toBe(parent.id);
    expect(child.rootId).toBe(parent.id);
    expect(child.path.startsWith(`${parent.path}/`)).toBe(true);
  });

  it('writes one batch with parents before children, for the self-referencing key', async () => {
    const { service, comments, upserted } = buildService();

    await service.ingest(CTX, [
      raw({
        platformCommentId: 'x-2',
        parentPlatformCommentId: 'x-1',
        createdAt: new Date('2026-01-01T00:05:00Z'),
      }),
      raw({ platformCommentId: 'x-1', createdAt: new Date('2026-01-01T00:00:00Z') }),
    ]);

    expect(comments.upsertMirrored).toHaveBeenCalledTimes(1);
    expect(upserted[0].map((c) => c.platformCommentId)).toEqual(['x-1', 'x-2']);
  });

  it('keeps the existing id, depth and path when a comment is re-synced', async () => {
    const existing = {
      id: 'existing-id',
      rootId: 'root-id',
      depth: 3,
      path: 'a/b/c/d',
      platformCommentId: 'x-1',
    } as Comment;
    const { service, upserted } = buildService(new Map([['x-1', existing]]));

    await service.ingest(CTX, [raw({ platformCommentId: 'x-1', body: 'edited upstream' })]);

    const [row] = upserted[0];
    // Rewriting a path would invalidate every descendant's.
    expect(row.id).toBe('existing-id');
    expect(row.depth).toBe(3);
    expect(row.path).toBe('a/b/c/d');
    expect(row.rootId).toBe('root-id');
    expect(row.body).toBe('edited upstream');
  });

  it('defers a reply whose parent is not in view rather than flattening it', async () => {
    const { service, upserted } = buildService();

    const result = await service.ingest(CTX, [
      raw({ platformCommentId: 'x-9', parentPlatformCommentId: 'missing' }),
    ]);

    expect(result.deferred).toBe(1);
    expect(result.imported).toBe(0);
    // Storing it at depth 0 would be a lie our next sync could not correct.
    expect(upserted[0] ?? []).toHaveLength(0);
  });

  it('marks mirrored rows as platform-origin with no delivery state', async () => {
    const { service, upserted } = buildService();

    await service.ingest(CTX, [raw()]);

    expect(upserted[0][0].origin).toBe('platform');
    expect(upserted[0][0].deliveryStatus).toBeNull();
  });
});
