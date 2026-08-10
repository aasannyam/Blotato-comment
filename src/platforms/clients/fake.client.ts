import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  FetchCommentsPage,
  FetchCommentsParams,
  PlatformCapabilities,
  PlatformCommentClient,
  PlatformContext,
  PublishReplyParams,
  PublishReplyResult,
  RawPlatformComment,
} from '../platform-client.interface';

/**
 * In-memory platform for local development and tests.
 *
 * Not scaffolding — it is the proof the abstraction holds: same interface,
 * entirely different mechanics, and it lets sync, the outbox, threading and
 * pagination be exercised end to end without credentials or network. It also
 * honours `requestId`, so the idempotency path is genuinely covered.
 */
@Injectable()
export class FakeCommentClient implements PlatformCommentClient {
  readonly platform = 'fake';

  readonly capabilities: PlatformCapabilities = {
    maxThreadDepth: 1,
    maxBodyLength: 500,
    supportsWebhooks: false,
    mentionOnReparent: true,
  };

  private readonly comments = new Map<string, RawPlatformComment[]>();
  private readonly published = new Map<string, PublishReplyResult>();

  seed(postId: string, input: Partial<RawPlatformComment> & { body: string }): RawPlatformComment {
    const comment: RawPlatformComment = {
      platformCommentId: input.platformCommentId ?? randomUUID(),
      parentPlatformCommentId: input.parentPlatformCommentId ?? null,
      body: input.body,
      author: input.author ?? {
        platformUserId: 'user-1',
        handle: 'demo_user',
        displayName: 'Demo User',
        avatarUrl: null,
      },
      createdAt: input.createdAt ?? new Date(),
      likeCount: input.likeCount ?? 0,
      replyCount: input.replyCount ?? 0,
      isFromOwner: input.isFromOwner ?? false,
      permalink: null,
      raw: {},
    };
    this.comments.set(postId, [...(this.comments.get(postId) ?? []), comment]);
    return comment;
  }

  async fetchComments(_ctx: PlatformContext, params: FetchCommentsParams): Promise<FetchCommentsPage> {
    const all = [...(this.comments.get(params.platformPostId) ?? [])].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const offset = Number(params.cursor ?? 0);
    const page = all.slice(offset, offset + params.limit);
    const next = offset + page.length;
    return { comments: page, nextCursor: next < all.length ? String(next) : null };
  }

  async publishReply(ctx: PlatformContext, params: PublishReplyParams): Promise<PublishReplyResult> {
    // Models a platform with request deduplication: replaying a requestId
    // returns the original result instead of creating a second comment.
    const existing = this.published.get(params.requestId);
    if (existing) return existing;

    const created = this.seed(params.platformPostId, {
      platformCommentId: `fake-${randomUUID()}`,
      parentPlatformCommentId: params.parentPlatformCommentId,
      body: params.body,
      isFromOwner: true,
      author: {
        platformUserId: ctx.platformAccountId,
        handle: 'owner',
        displayName: 'Owner',
        avatarUrl: null,
      },
    });

    const result = {
      platformCommentId: created.platformCommentId,
      createdAt: created.createdAt,
      permalink: null,
    };
    this.published.set(params.requestId, result);
    return result;
  }

  reset(): void {
    this.comments.clear();
    this.published.clear();
  }
}
