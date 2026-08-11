import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { PlatformError } from '../../platforms/platform.errors';
import { PlatformRegistry } from '../../platforms/platform-registry.service';
import { PostsService } from '../../posts/posts.service';
import { CommentsRepository } from '../repositories/comments.repository';
import { Comment } from '../entities/comment.entity';

const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const VISIBILITY_SECONDS = 60;

@Injectable()
export class ReplyDispatcherService {
  private readonly logger = new Logger(ReplyDispatcherService.name);
  private readonly enabled: boolean;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private running = false;

  constructor(
    private readonly comments: CommentsRepository,
    private readonly posts: PostsService,
    private readonly registry: PlatformRegistry,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('workers.enabled', true);
    this.batchSize = config.get<number>('reply.dispatchBatchSize', 25);
    this.maxAttempts = config.get<number>('reply.maxAttempts', 6);
  }

  @Interval('reply-dispatcher', 1_000)
  async tick(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      await this.dispatchBatch();
    } catch (error) {
      this.logger.error('Dispatch batch failed', error as Error);
    } finally {
      this.running = false;
    }
  }

  async dispatchBatch(): Promise<number> {
    const claimed = await this.comments.claimDueReplies(this.batchSize, VISIBILITY_SECONDS);
    for (const reply of claimed) await this.deliver(reply);
    return claimed.length;
  }

  async deliver(reply: Comment): Promise<void> {
    try {
      const ctx = await this.posts.getPublishedPost(reply.workspaceId, reply.postId);
      const client = this.registry.get(reply.platform);

      // The parent's platform id, not ours: its own delivery may have failed since.
      let parentPlatformCommentId: string | null = null;
      if (reply.parentId) {
        const parent = await this.comments.findById(reply.workspaceId, reply.parentId);
        if (!parent?.platformCommentId) {
          await this.retryLater(reply, {
            code: 'PARENT_NOT_PUBLISHED',
            message: 'Parent comment has not been published yet.',
            retryable: true,
          });
          return;
        }
        parentPlatformCommentId = parent.platformCommentId;
      }

      const result = await client.publishReply(ctx.platformContext, {
        platformPostId: ctx.post.platformPostId,
        parentPlatformCommentId,
        body: reply.body,
        // Stable across retries, so a deduplicating platform collapses an ambiguous timeout.
        requestId: reply.id,
      });

      await this.comments.markSent(
        reply.id,
        result.platformCommentId,
        result.createdAt,
        result.permalink,
      );
    } catch (error) {
      await this.handleFailure(reply, error);
    }
  }

  private async handleFailure(reply: Comment, error: unknown): Promise<void> {
    const platformError = error instanceof PlatformError ? error : null;
    const detail = {
      code: platformError?.code ?? 'UNKNOWN',
      message: error instanceof Error ? error.message : 'delivery failed',
      retryable: platformError?.retryable ?? false,
    };

    // A revoked token or rejected body never improves with retries.
    if (!detail.retryable || reply.deliveryAttempts >= this.maxAttempts) {
      await this.comments.markFailed(reply.id, detail);
      this.logger.warn(`Reply ${reply.id} failed permanently: ${detail.code}`);
      return;
    }

    await this.retryLater(reply, detail, platformError?.retryAfterMs);
  }

  private async retryLater(
    reply: Comment,
    detail: { code: string; message: string; retryable: boolean },
    retryAfterMs?: number,
  ): Promise<void> {
    const delay = retryAfterMs ?? this.backoff(reply.deliveryAttempts);
    await this.comments.markRetry(reply.id, new Date(Date.now() + delay), detail);
  }

  private backoff(attempt: number): number {
    const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
    return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
  }
}
