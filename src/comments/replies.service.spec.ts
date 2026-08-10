import {
  DomainException,
  IdempotencyConflictException,
  ReplyTooLongException,
} from '../common/errors/domain.exception';
import { PlatformCapabilities } from '../platforms/platform-client.interface';
import { Comment } from './entities/comment.entity';
import { RepliesService } from './replies.service';

/** Instagram-shaped: flat replies, short-ish limit, mentions on re-parent. */
const FLAT: PlatformCapabilities = {
  maxThreadDepth: 1,
  maxBodyLength: 100,
  supportsWebhooks: true,
  mentionOnReparent: true,
};

function comment(overrides: Record<string, unknown> = {}): Comment {
  return {
    id: 'c-1',
    workspaceId: 'ws-1',
    postId: 'post-1',
    depth: 0,
    rootId: 'c-1',
    path: '00001700000000000-aaaa0000',
    origin: 'platform',
    deliveryStatus: null,
    deletedAt: null,
    platformCommentId: 'x-1',
    ...overrides,
  } as unknown as Comment;
}

function buildService(options: {
  capabilities?: PlatformCapabilities;
  parent?: Comment | null;
  ancestor?: Comment | null;
  existingByKey?: Comment | null;
} = {}) {
  const comments = {
    findById: jest.fn().mockResolvedValue(options.parent ?? null),
    findByPath: jest.fn().mockResolvedValue(options.ancestor ?? null),
    findByIdempotencyKey: jest.fn().mockResolvedValue(options.existingByKey ?? null),
    create: jest.fn((data: Partial<Comment>) => data as Comment),
    save: jest.fn(async (c: Comment) => c),
  };

  const service = new RepliesService(
    comments as never,
    { ensure: jest.fn().mockResolvedValue({ id: 'author-1' }) } as never,
    {
      getPublishedPost: jest.fn().mockResolvedValue({
        post: { id: 'post-1', workspaceId: 'ws-1', platform: 'fake', platformPostId: 'p-1' },
        account: { id: 'acc-1', platformAccountId: 'owner', handle: 'blotato' },
        platformContext: {},
      }),
    } as never,
    { capabilities: () => options.capabilities ?? FLAT } as never,
  );

  return { service, comments };
}

describe('RepliesService.createReply', () => {
  it('queues the reply as pending instead of calling the platform', async () => {
    const { service } = buildService({ parent: comment() });

    const { comment: reply } = await service.createReply({
      workspaceId: 'ws-1',
      parentCommentId: 'c-1',
      body: 'hello',
    });

    expect(reply.origin).toBe('blotato');
    expect(reply.deliveryStatus).toBe('pending');
    expect(reply.platformCommentId).toBeNull();
  });

  it('re-parents a reply the platform cannot nest, and mentions the original target', async () => {
    const target = comment({
      id: 'c-2',
      depth: 1,
      rootId: 'c-1',
      path: '00001700000000000-aaaa0000/00001700000000001-bbbb0000',
      author: { handle: 'nina' },
    });

    const { service } = buildService({ parent: target, ancestor: comment({ id: 'c-1' }) });

    const { comment: reply } = await service.createReply({
      workspaceId: 'ws-1',
      parentCommentId: 'c-2',
      body: 'thanks!',
    });

    // The platform would flatten this anyway; storing the requested parent would
    // leave our mirror disagreeing with it after the next sync.
    expect(reply.parentId).toBe('c-1');
    expect(reply.depth).toBe(1);
    expect(reply.wasReparented).toBe(true);
    expect(reply.body).toBe('@nina thanks!');
  });

  it('keeps the requested parent when the platform allows that depth', async () => {
    const { service } = buildService({ parent: comment() });

    const { comment: reply } = await service.createReply({
      workspaceId: 'ws-1',
      parentCommentId: 'c-1',
      body: 'noted',
    });

    expect(reply.parentId).toBe('c-1');
    expect(reply.wasReparented).toBe(false);
    expect(reply.body).toBe('noted');
  });

  it('counts a prepended mention against the platform limit', async () => {
    const target = comment({ id: 'c-2', depth: 1, path: 'a/b', author: { handle: 'nina' } });

    const { service } = buildService({
      parent: target,
      ancestor: comment({ id: 'c-1' }),
      capabilities: { ...FLAT, maxBodyLength: 12 },
    });

    await expect(
      service.createReply({ workspaceId: 'ws-1', parentCommentId: 'c-2', body: 'exactly ten' }),
    ).rejects.toBeInstanceOf(ReplyTooLongException);
  });

  it('replays an idempotent retry instead of posting twice', async () => {
    const input = {
      workspaceId: 'ws-1',
      parentCommentId: 'c-1',
      body: 'same body',
      idempotencyKey: 'key-1',
    };

    const first = buildService({ parent: comment() });
    const created = (await first.service.createReply(input)).comment;

    const retry = buildService({ parent: comment(), existingByKey: created });
    const result = await retry.service.createReply(input);

    expect(result.replayed).toBe(true);
    expect(result.comment).toBe(created);
    expect(retry.comments.save).not.toHaveBeenCalled();
  });

  it('rejects a reused idempotency key carrying a different body', async () => {
    const existing = comment({ id: 'c-9', requestFingerprint: 'a-different-hash' });
    const { service } = buildService({ parent: comment(), existingByKey: existing });

    await expect(
      service.createReply({
        workspaceId: 'ws-1',
        parentCommentId: 'c-1',
        body: 'changed my mind',
        idempotencyKey: 'key-1',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictException);
  });

  it('refuses to reply to a comment that has not reached the platform', async () => {
    const undelivered = comment({ origin: 'blotato', deliveryStatus: 'pending' });
    const { service } = buildService({ parent: undelivered });

    await expect(
      service.createReply({ workspaceId: 'ws-1', parentCommentId: 'c-1', body: 'hi' }),
    ).rejects.toBeInstanceOf(DomainException);
  });
});
