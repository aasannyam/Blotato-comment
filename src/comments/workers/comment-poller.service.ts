import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { PostsService } from '../../posts/posts.service';
import { CommentSyncService } from '../services/comment-sync.service';

/**
 * Refreshes the mirror for posts whose platform cannot push events. The
 * "how often" policy lives in `CommentSyncService`; this only runs what is due.
 */
@Injectable()
export class CommentPollerService {
  private readonly logger = new Logger(CommentPollerService.name);
  private readonly enabled: boolean;
  private readonly batchSize: number;
  private running = false;

  constructor(
    private readonly sync: CommentSyncService,
    private readonly posts: PostsService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('workers.enabled', true);
    this.batchSize = config.get<number>('sync.pollBatchSize', 20);
  }

  @Interval('comment-poller', 10_000)
  async tick(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      await this.pollDuePosts();
    } catch (error) {
      this.logger.error('Poll batch failed', error as Error);
    } finally {
      this.running = false;
    }
  }

  async pollDuePosts(): Promise<number> {
    const due = await this.sync.claimDuePosts(this.batchSize);

    for (const state of due) {
      try {
        const ctx = await this.posts.getPublishedPost(state.workspaceId, state.postId);
        await this.sync.syncPost(ctx, 1);
      } catch {
        // syncPost already recorded the failure and pushed next_poll_at out; one
        // bad post must not abort the batch.
        this.logger.warn(`Poll failed for post ${state.postId}`);
      }
    }
    return due.length;
  }
}
