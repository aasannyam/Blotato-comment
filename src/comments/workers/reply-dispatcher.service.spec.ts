import { PlatformError } from '../../platforms/platform.errors';
import { Comment } from '../entities/comment.entity';
import { ReplyDispatcherService } from './reply-dispatcher.service';

function reply(overrides: Record<string, unknown> = {}): Comment {
  return {
    id: 'r-1',
    workspaceId: 'ws-1',
    postId: 'post-1',
    platform: 'fake',
    parentId: null,
    body: 'hello',
    deliveryAttempts: 1,
    ...overrides,
  } as unknown as Comment;
}

function buildDispatcher(publishReply: jest.Mock, parent?: Comment) {
  const comments = {
    findById: jest.fn().mockResolvedValue(parent ?? null),
    markSent: jest.fn(),
    markRetry: jest.fn(),
    markFailed: jest.fn(),
    claimDueReplies: jest.fn(),
  };

  const dispatcher = new ReplyDispatcherService(
    comments as never,
    {
      getPublishedPost: jest.fn().mockResolvedValue({
        post: { platformPostId: 'p-1' },
        platformContext: {},
      }),
    } as never,
    { get: () => ({ publishReply }) } as never,
    { get: (_key: string, fallback: unknown) => fallback } as never,
  );

  return { dispatcher, comments };
}

describe('ReplyDispatcherService.deliver', () => {
  it('records the platform id on success', async () => {
    const createdAt = new Date();
    const publish = jest.fn().mockResolvedValue({
      platformCommentId: 'x-99',
      createdAt,
      permalink: null,
    });
    const { dispatcher, comments } = buildDispatcher(publish);

    await dispatcher.deliver(reply());

    expect(comments.markSent).toHaveBeenCalledWith('r-1', 'x-99', createdAt, null);
    // The reply id is the request id, so a retry after a timeout is deduplicable.
    expect(publish.mock.calls[0][1]).toMatchObject({ requestId: 'r-1' });
  });

  it('never retries a write the platform accepted but did not identify', async () => {
    const publish = jest
      .fn()
      .mockRejectedValue(
        new PlatformError({
          code: 'UNCONFIRMED_WRITE',
          platform: 'fake',
          message: 'reply accepted but no id returned',
        }),
      );
    const { dispatcher, comments } = buildDispatcher(publish);

    await dispatcher.deliver(reply({ deliveryAttempts: 1 }));

    // The comment is already public; a retry would post it a second time.
    expect(comments.markFailed).toHaveBeenCalled();
    expect(comments.markRetry).not.toHaveBeenCalled();
  });

  it('schedules a retry for a transient failure', async () => {
    const publish = jest
      .fn()
      .mockRejectedValue(
        new PlatformError({ code: 'RATE_LIMITED', platform: 'fake', message: '429' }),
      );
    const { dispatcher, comments } = buildDispatcher(publish);

    await dispatcher.deliver(reply());

    expect(comments.markRetry).toHaveBeenCalled();
    expect(comments.markFailed).not.toHaveBeenCalled();
  });

  it('fails immediately on a revoked token rather than burning attempts', async () => {
    const publish = jest
      .fn()
      .mockRejectedValue(
        new PlatformError({ code: 'AUTH_EXPIRED', platform: 'fake', message: '401' }),
      );
    const { dispatcher, comments } = buildDispatcher(publish);

    await dispatcher.deliver(reply());

    expect(comments.markFailed).toHaveBeenCalled();
    expect(comments.markRetry).not.toHaveBeenCalled();
  });

  it('gives up once the attempt budget is exhausted', async () => {
    const publish = jest
      .fn()
      .mockRejectedValue(new PlatformError({ code: 'UNAVAILABLE', platform: 'fake', message: '503' }));
    const { dispatcher, comments } = buildDispatcher(publish);

    await dispatcher.deliver(reply({ deliveryAttempts: 6 }));

    expect(comments.markFailed).toHaveBeenCalled();
  });

  it('waits instead of sending when the parent is still undelivered', async () => {
    const publish = jest.fn();
    const { dispatcher, comments } = buildDispatcher(
      publish,
      reply({ id: 'r-0', platformCommentId: null }),
    );

    await dispatcher.deliver(reply({ parentId: 'r-0' }));

    expect(publish).not.toHaveBeenCalled();
    expect(comments.markRetry).toHaveBeenCalled();
  });
});
