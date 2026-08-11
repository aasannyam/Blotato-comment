import { Comment } from '../entities/comment.entity';
import { CommentResponse } from './comment.response';

function comment(overrides: Record<string, unknown> = {}): Comment {
  return {
    id: 'c-1',
    postId: 'post-1',
    platform: 'instagram',
    platformCommentId: 'ig-1',
    parentId: null,
    rootId: 'c-1',
    depth: 0,
    body: 'hello',
    author: { id: 'a-1', handle: 'nina', displayName: 'Nina', avatarUrl: null },
    likeCount: 3,
    replyCount: 2,
    isFromOwner: false,
    permalink: null,
    origin: 'platform',
    deliveryStatus: null,
    deliveryAttempts: 0,
    lastError: null,
    wasReparented: false,
    path: '00001700000000000-aaaa0000',
    raw: { secret: 'platform payload' },
    sortAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as Comment;
}

describe('CommentResponse.from', () => {
  it('never leaks the raw platform payload or the storage path', () => {
    const dto = JSON.parse(JSON.stringify(CommentResponse.from(comment())));

    // `raw` is internal and a stable-API liability; `path` is a storage detail.
    expect(dto).not.toHaveProperty('raw');
    expect(dto).not.toHaveProperty('path');
    expect(JSON.stringify(dto)).not.toContain('platform payload');
  });

  it('omits delivery for a mirrored comment and reports it for our own reply', () => {
    expect(CommentResponse.from(comment()).delivery).toBeNull();

    const queued = CommentResponse.from(
      comment({
        origin: 'blotato',
        deliveryStatus: 'pending',
        deliveryAttempts: 1,
        platformCommentId: null,
        isFromOwner: true,
      }),
    );

    expect(queued.delivery).toEqual({ status: 'pending', attempts: 1, error: null });
    // Null until delivery lands, which is what makes "pending" queryable.
    expect(queued.platformCommentId).toBeNull();
  });
});
