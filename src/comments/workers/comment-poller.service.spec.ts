import { CommentPollerService } from './comment-poller.service';

function buildPoller(due: { postId: string; workspaceId: string }[], failingPostId?: string) {
  const syncPost = jest.fn().mockResolvedValue({ imported: 1, deferred: 0, syncedAt: new Date() });
  const sync = { claimDuePosts: jest.fn().mockResolvedValue(due), syncPost };

  const posts = {
    getPublishedPost: jest.fn(async (_ws: string, postId: string) => {
      if (postId === failingPostId) throw new Error('account disconnected');
      return { post: { id: postId } };
    }),
  };

  const poller = new CommentPollerService(sync as never, posts as never, {
    get: (_key: string, fallback: unknown) => fallback,
  } as never);

  return { poller, sync, syncPost };
}

describe('CommentPollerService.pollDuePosts', () => {
  it('keeps going when one post fails, instead of losing the rest of the batch', async () => {
    const due = [
      { postId: 'bad', workspaceId: 'ws-1' },
      { postId: 'good-1', workspaceId: 'ws-1' },
      { postId: 'good-2', workspaceId: 'ws-2' },
    ];
    const { poller, syncPost } = buildPoller(due, 'bad');

    const count = await poller.pollDuePosts();

    // One disconnected account must not stall every other workspace's sync.
    expect(count).toBe(3);
    expect(syncPost).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no post is due', async () => {
    const { poller, sync, syncPost } = buildPoller([]);

    expect(await poller.pollDuePosts()).toBe(0);
    expect(sync.claimDuePosts).toHaveBeenCalled();
    expect(syncPost).not.toHaveBeenCalled();
  });
});
