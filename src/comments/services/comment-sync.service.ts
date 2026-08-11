import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RawPlatformComment } from '../../platforms/platform-client.interface';
import { PlatformError } from '../../platforms/platform.errors';
import { PlatformRegistry } from '../../platforms/platform-registry.service';
import { PublishedPostContext } from '../../posts/posts.service';
import { CommentAuthorsRepository } from '../repositories/comment-authors.repository';
import { CommentsRepository } from '../repositories/comments.repository';
import { SyncStateRepository } from '../repositories/comment-sync-state.repository';
import { Comment } from '../entities/comment.entity';
import { CommentSyncState } from '../entities/comment-sync-state.entity';
import { childPath } from '../threading/thread-path';

export interface SyncResult {
  imported: number;
  /** Comments whose parent was not in this page; picked up on the next pass. */
  deferred: number;
  syncedAt: Date;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const POLL_VISIBILITY_SECONDS = 120;

/** Extra pages allowed purely to resolve replies whose parent was not in view. */
const EXTRA_PAGES_FOR_ORPHANS = 2;

@Injectable()
export class CommentSyncService {
  private readonly logger = new Logger(CommentSyncService.name);

  constructor(
    private readonly registry: PlatformRegistry,
    private readonly comments: CommentsRepository,
    private readonly authors: CommentAuthorsRepository,
    private readonly state: SyncStateRepository,
  ) {}

  async syncPost(ctx: PublishedPostContext, maxPages = 1): Promise<SyncResult> {
    const client = this.registry.get(ctx.post.platform);
    const state = await this.ensureState(ctx);

    let imported = 0;
    let deferred = 0;
    let cursor: string | null = null;

    try {
      for (let page = 0; page < maxPages + EXTRA_PAGES_FOR_ORPHANS; page++) {
        const result = await client.fetchComments(ctx.platformContext, {
          platformPostId: ctx.post.platformPostId,
          cursor,
          limit: 100,
        });

        const persisted = await this.ingest(ctx, result.comments);
        imported += persisted.imported;
        deferred += persisted.deferred;

        cursor = result.nextCursor;
        if (!cursor) break;

        // Past the page budget, keep paging only while orphans remain unresolved.
        if (page + 1 >= maxPages && persisted.deferred === 0) break;
      }
      await this.recordSuccess(state, ctx);
    } catch (error) {
      await this.recordFailure(state, error);
      throw error;
    }

    if (deferred > 0) {
      this.logger.warn(
        `Post ${ctx.post.id}: ${deferred} comment(s) still orphaned after ${maxPages + EXTRA_PAGES_FOR_ORPHANS} page(s)`,
      );
    }

    return { imported, deferred, syncedAt: new Date() };
  }

  async ingest(
    ctx: PublishedPostContext,
    raw: readonly RawPlatformComment[],
  ): Promise<{ imported: number; deferred: number }> {
    if (raw.length === 0) return { imported: 0, deferred: 0 };

    const platformIds = new Set<string>();
    for (const comment of raw) {
      platformIds.add(comment.platformCommentId);
      if (comment.parentPlatformCommentId) platformIds.add(comment.parentPlatformCommentId);
    }

    const known = await this.comments.findByPlatformIds(ctx.account.id, [...platformIds]);
    const authors = await this.authors.ensureMany(
      raw.map((c) => ({ platform: ctx.post.platform, ...c.author })),
    );

    const now = new Date();
    const batch: Comment[] = [];
    let deferred = 0;

    for (const item of [...raw].sort((a, b) => +a.createdAt - +b.createdAt)) {
      const parent = item.parentPlatformCommentId
        ? known.get(item.parentPlatformCommentId)
        : undefined;
      if (item.parentPlatformCommentId && !parent) {
        deferred++;
        continue;
      }

      const existing = known.get(item.platformCommentId);
      const id = existing?.id ?? randomUUID();

      const comment = this.comments.create({
        id,
        workspaceId: ctx.post.workspaceId,
        postId: ctx.post.id,
        socialAccountId: ctx.account.id,
        platform: ctx.post.platform,
        platformCommentId: item.platformCommentId,
        parentId: parent?.id ?? null,
        rootId: existing?.rootId ?? parent?.rootId ?? id,
        depth: existing?.depth ?? (parent ? parent.depth + 1 : 0),
        path: existing?.path ?? childPath(parent?.path ?? null, id, item.createdAt),
        authorId: authors.get(`${ctx.post.platform}:${item.author.platformUserId}`)?.id ?? null,
        body: item.body,
        likeCount: item.likeCount ?? 0,
        replyCount: item.replyCount ?? 0,
        isFromOwner: item.isFromOwner,
        permalink: item.permalink,
        raw: item.raw,
        platformCreatedAt: item.createdAt,
        syncedAt: now,
        origin: 'platform',
        deliveryStatus: null,
      });

      // Parents precede children here, so the self-referencing key holds in one statement.
      batch.push(comment);
      known.set(item.platformCommentId, comment);
    }

    await this.comments.upsertMirrored(batch);
    return { imported: batch.length, deferred };
  }

  async ensureState(ctx: PublishedPostContext): Promise<CommentSyncState> {
    const existing = await this.state.findByPostId(ctx.post.id);
    if (existing) return existing;

    return this.state.save(
      this.state.create({
        postId: ctx.post.id,
        workspaceId: ctx.post.workspaceId,
        platform: ctx.post.platform,
        nextPollAt: new Date(),
      }),
    );
  }

  /** Atomic claim, so a second worker cannot poll the same post. */
  claimDuePosts(limit: number): Promise<CommentSyncState[]> {
    return this.state.claimDue(limit, POLL_VISIBILITY_SECONDS);
  }

  private async recordSuccess(state: CommentSyncState, ctx: PublishedPostContext): Promise<void> {
    state.lastSyncedAt = new Date();
    state.consecutiveFailures = 0;
    state.lastError = null;
    state.nextPollAt = new Date(Date.now() + this.pollInterval(ctx));
    await this.state.save(state);
  }

  private async recordFailure(state: CommentSyncState, error: unknown): Promise<void> {
    state.consecutiveFailures += 1;
    const platformError = error instanceof PlatformError ? error : null;
    state.lastError = {
      code: platformError?.code ?? 'UNKNOWN',
      message: error instanceof Error ? error.message : 'sync failed',
    };

    // Capped backoff: an outage must not become a thundering herd on recovery.
    const backoff = Math.min(MINUTE * 2 ** Math.min(state.consecutiveFailures, 8), 6 * HOUR);
    state.nextPollAt = new Date(Date.now() + (platformError?.retryAfterMs ?? backoff));
    await this.state.save(state);
    this.logger.warn(`Sync failed for post ${state.postId}: ${state.lastError.code}`);
  }

  private pollInterval(ctx: PublishedPostContext): number {
    const ageMs = Date.now() - (ctx.post.publishedAt?.getTime() ?? Date.now());

    let interval: number;
    if (ageMs < HOUR) interval = MINUTE;
    else if (ageMs < 24 * HOUR) interval = 5 * MINUTE;
    else if (ageMs < 7 * 24 * HOUR) interval = 30 * MINUTE;
    else interval = 6 * HOUR;

    // Webhook platforms push changes; polling is only a reconciliation net.
    if (this.registry.capabilities(ctx.post.platform).supportsWebhooks) interval *= 10;

    return Math.min(interval, 12 * HOUR);
  }
}
