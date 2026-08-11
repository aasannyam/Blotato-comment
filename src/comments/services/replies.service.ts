import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import {
  CommentNotFoundException,
  DomainException,
  IdempotencyConflictException,
  ReplyTooLongException,
} from '../../common/errors/domain.exception';
import { PlatformCapabilities } from '../../platforms/platform-client.interface';
import { PlatformRegistry } from '../../platforms/platform-registry.service';
import { PostsService, PublishedPostContext } from '../../posts/posts.service';
import { CommentAuthorsRepository } from '../repositories/comment-authors.repository';
import { CommentsRepository } from '../repositories/comments.repository';
import { Comment } from '../entities/comment.entity';
import { ancestorPathAtDepth, childPath } from '../threading/thread-path';

export interface CreateReplyInput {
  workspaceId: string;
  parentCommentId?: string;
  postId?: string;
  body: string;
  idempotencyKey?: string;
}

export interface CreateReplyOutcome {
  comment: Comment;
  replayed: boolean;
}

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class RepliesService {
  constructor(
    private readonly comments: CommentsRepository,
    private readonly authors: CommentAuthorsRepository,
    private readonly posts: PostsService,
    private readonly registry: PlatformRegistry,
  ) {}

  /**
   * Accepts a reply into the outbox without calling the platform.
   *
   * Inline, a 30s timeout on X becomes a 30s HTTP request, a 429 becomes the
   * user's problem, and a network failure after the platform accepted the write
   * becomes a duplicate comment. Committing locally as `pending` lets the reply
   * render in its thread immediately while delivery is retried out of band.
   */
  async createReply(input: CreateReplyInput): Promise<CreateReplyOutcome> {
    const fingerprint = this.fingerprint(input);

    if (input.idempotencyKey) {
      const existing = await this.comments.findByIdempotencyKey(
        input.workspaceId,
        input.idempotencyKey,
      );
      if (existing) return this.replay(existing, fingerprint, input.idempotencyKey);
    }

    const { ctx, parent } = await this.resolveContext(input);
    const capabilities = this.registry.capabilities(ctx.post.platform);
    const target = await this.resolveTarget(ctx, parent, capabilities);
    const body = this.applyMention(input.body, target, capabilities);

    // After the mention: it counts against the limit, and discovering that at
    // delivery time is a failure the user cannot see or fix.
    if (body.length > capabilities.maxBodyLength) {
      throw new ReplyTooLongException(ctx.post.platform, body.length, capabilities.maxBodyLength);
    }

    const author = await this.authors.ensure({
      platform: ctx.post.platform,
      platformUserId: ctx.account.platformAccountId,
      handle: ctx.account.handle,
      displayName: ctx.account.handle,
      avatarUrl: null,
    });

    const id = randomUUID();
    const now = new Date();
    const effectiveParent = target.parent;

    const reply = this.comments.create({
      id,
      workspaceId: ctx.post.workspaceId,
      postId: ctx.post.id,
      socialAccountId: ctx.account.id,
      platform: ctx.post.platform,
      platformCommentId: null,
      parentId: effectiveParent?.id ?? null,
      rootId: effectiveParent?.rootId ?? id,
      depth: effectiveParent ? effectiveParent.depth + 1 : 0,
      path: childPath(effectiveParent?.path ?? null, id, now),
      authorId: author.id,
      body,
      isFromOwner: true,
      origin: 'blotato',
      deliveryStatus: 'pending',
      nextAttemptAt: now,
      idempotencyKey: input.idempotencyKey ?? null,
      requestFingerprint: fingerprint,
      wasReparented: target.reparented,
    });

    try {
      return { comment: await this.comments.save(reply), replayed: false };
    } catch (error) {
      // Two identical requests raced past the lookup above. The unique index is
      // the real guarantee; this turns it back into the replay answer.
      if (this.isUniqueViolation(error) && input.idempotencyKey) {
        const existing = await this.comments.findByIdempotencyKey(
          input.workspaceId,
          input.idempotencyKey,
        );
        if (existing) return this.replay(existing, fingerprint, input.idempotencyKey);
      }
      throw error;
    }
  }

  private async resolveContext(
    input: CreateReplyInput,
  ): Promise<{ ctx: PublishedPostContext; parent: Comment | null }> {
    if (input.parentCommentId) {
      const parent = await this.comments.findById(input.workspaceId, input.parentCommentId);
      if (!parent || parent.deletedAt) throw new CommentNotFoundException(input.parentCommentId);

      // An undelivered parent has no upstream id for this reply to attach to.
      if (parent.origin === 'blotato' && parent.deliveryStatus !== 'sent') {
        throw new DomainException(
          'parent_not_published',
          'The comment being replied to has not reached the platform yet.',
          HttpStatus.CONFLICT,
          { parentCommentId: parent.id, deliveryStatus: parent.deliveryStatus },
        );
      }
      return { ctx: await this.posts.getPublishedPost(input.workspaceId, parent.postId), parent };
    }

    if (!input.postId) {
      throw new DomainException(
        'reply_target_missing',
        'Either a post or a parent comment must be supplied.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return { ctx: await this.posts.getPublishedPost(input.workspaceId, input.postId), parent: null };
  }

  /**
   * Instagram, TikTok and YouTube flatten a reply-to-a-reply onto the top-level
   * thread. Storing the requested parent would put our mirror at odds with the
   * platform on the next sync, so we re-parent and record that we did.
   */
  private async resolveTarget(
    ctx: PublishedPostContext,
    parent: Comment | null,
    capabilities: PlatformCapabilities,
  ): Promise<{ parent: Comment | null; requested: Comment | null; reparented: boolean }> {
    const maxDepth = capabilities.maxThreadDepth;
    if (!parent || maxDepth === null || parent.depth + 1 <= maxDepth) {
      return { parent, requested: parent, reparented: false };
    }

    const ancestorPath = ancestorPathAtDepth(parent.path, maxDepth - 1);
    const ancestor = await this.comments.findByPath(ctx.post.workspaceId, ctx.post.id, ancestorPath);

    return { parent: ancestor ?? parent, requested: parent, reparented: true };
  }

  /** A hoisted reply would otherwise read as though it answered the original poster. */
  private applyMention(
    body: string,
    target: { requested: Comment | null; reparented: boolean },
    capabilities: PlatformCapabilities,
  ): string {
    if (!target.reparented || !capabilities.mentionOnReparent) return body;

    const handle = target.requested?.author?.handle;
    if (!handle || body.includes(`@${handle}`)) return body;
    return `@${handle} ${body}`;
  }

  private replay(existing: Comment, fingerprint: string, key: string): CreateReplyOutcome {
    if (existing.requestFingerprint !== fingerprint) throw new IdempotencyConflictException(key);
    return { comment: existing, replayed: true };
  }

  /** Binds a key to its request, so reuse with a different body is caught. */
  private fingerprint(input: CreateReplyInput): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          workspaceId: input.workspaceId,
          postId: input.postId ?? null,
          parentCommentId: input.parentCommentId ?? null,
          body: input.body,
        }),
      )
      .digest('hex');
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string } | undefined)?.code === PG_UNIQUE_VIOLATION
    );
  }
}
