import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { RawPlatformComment } from '../platforms/platform-client.interface';
import { PlatformError } from '../platforms/platform.errors';
import { PlatformRegistry } from '../platforms/platform-registry.service';
import { PublishedPostContext } from '../posts/posts.service';
import { CommentAuthorsRepository } from './comment-authors.repository';
import { CommentsRepository } from './comments.repository';
import { CommentSyncState } from './entities/comment-sync-state.entity';
import { childPath } from './thread-path';

export interface SyncResult {
  imported: number;
  /** Comments whose parent was not in this page; picked up on the next pass. */
  deferred: number;
  syncedAt: Date;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

@Injectable()
export class CommentSyncService {
  private readonly logger = new Logger(CommentSyncService.name);

  constructor(
    private readonly registry: PlatformRegistry,
    private readonly comments: CommentsRepository,
    private readonly authors: CommentAuthorsRepository,
    @InjectRepository(CommentSyncState) private readonly state: Repository<CommentSyncState>,
  ) {}

  /**
   * Always re-reads from the head rather than resuming a stored cursor: comments
   * are edited, deleted and moderated after the fact, so a cursor-only strategy
   * drifts permanently out of sync. The upsert makes re-reading cheap.
   */
  async syncPost(ctx: PublishedPostContext, maxPages = 1): Promise<SyncResult> {
    const client = this.registry.get(ctx.post.platform);
    const state = await this.ensureState(ctx);

    let imported = 0;
    let deferred = 0;
    let cursor: string | null = null;

    try {
      for (let page = 0; page < maxPages; page++) {
        const result = await client.fetchComments(ctx.platformContext, {
          platformPostId: ctx.post.platformPostId,
          cursor,
          limit: 100,
        });

        const persisted = await this.persist(ctx, result.comments);
        imported += persisted.imported;
        deferred += persisted.deferred;

        cursor = result.nextCursor;
        if (!cursor) break;
      }
      await this.recordSuccess(state, ctx);
    } catch (error) {
      await this.recordFailure(state, error);
      throw error;
    }

    return { imported, deferred, syncedAt: new Date() };
  }

  /**
   * A comment we have seen must keep its existing id, depth and path, or its
   * children would point at a row that never existed. Replies can also precede
   * their parent in a page: oldest-first handles the common case, and anything
   * still unresolved is deferred rather than silently flattened to top level.
   */
  private async persist(
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
    let imported = 0;
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

      await this.comments.upsertMirrored(comment);
      known.set(item.platformCommentId, comment);
      imported++;
    }

    return { imported, deferred };
  }

  async ensureState(ctx: PublishedPostContext): Promise<CommentSyncState> {
    const existing = await this.state.findOne({ where: { postId: ctx.post.id } });
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

  claimDuePosts(limit: number): Promise<CommentSyncState[]> {
    return this.state
      .createQueryBuilder('s')
      .where('s.nextPollAt <= now()')
      .orderBy('s.nextPollAt', 'ASC')
      .limit(limit)
      .getMany();
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

  /**
   * Comment activity decays sharply with post age, so a flat interval either
   * burns the rate-limit budget on dormant posts or leaves fresh ones stale.
   */
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
