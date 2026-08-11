import { PlatformError } from '../../platforms/platform.errors';
import { Comment } from '../entities/comment.entity';
import { CommentsService } from './comments.service';

function comment(id: string): Comment {
  return { id, sortAt: new Date('2026-01-01T00:00:00Z') } as unknown as Comment;
}

describe('CommentsService.listPostComments', () => {
  it('serves cached comments with meta.syncError when a live refresh fails', async () => {
    const syncPost = jest
      .fn()
      .mockRejectedValue(
        new PlatformError({ code: 'RATE_LIMITED', platform: 'instagram', message: '429' }),
      );

    const service = new CommentsService(
      { listTopLevel: jest.fn().mockResolvedValue([comment('c-1'), comment('c-2')]) } as never,
      { getPublishedPost: jest.fn().mockResolvedValue({ post: { id: 'post-1' } }) } as never,
      { syncPost } as never,
      { findByPostId: jest.fn().mockResolvedValue({ lastSyncedAt: new Date() }) } as never,
      { get: (_key: string, fallback: unknown) => fallback } as never,
    );

    const page = await service.listPostComments('ws-1', 'post-1', {
      limit: 25,
      order: 'oldest',
      refresh: true,
    });

    expect(syncPost).toHaveBeenCalled();
    // A slightly stale answer beats a 502, as long as the caller is told which.
    expect(page.data.map((c) => c.id)).toEqual(['c-1', 'c-2']);
    expect(page.meta.syncError).toEqual({ code: 'RATE_LIMITED', message: '429' });
    expect(page.meta.stale).toBe(false);
  });
});
