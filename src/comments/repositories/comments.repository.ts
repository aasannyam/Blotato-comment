import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { CursorPayload } from '../../common/pagination/cursor';
import { Comment } from '../entities/comment.entity';
import { descendantPattern } from '../threading/thread-path';

export type SortOrder = 'oldest' | 'newest';

export interface ListParams {
  workspaceId: string;
  limit: number;
  cursor: CursorPayload | null;
  order: SortOrder;
}

/** All optional and combinable; absent means "no constraint on this dimension". */
export interface SearchFilters {
  postId?: string;
  parentCommentId?: string;
  platform?: string;
  since?: Date;
  until?: Date;
  unansweredOnly?: boolean;
}

@Injectable()
export class CommentsRepository {
  constructor(@InjectRepository(Comment) private readonly repo: Repository<Comment>) {}

  private scoped(workspaceId: string): SelectQueryBuilder<Comment> {
    return this.repo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.author', 'author')
      .where('c.workspaceId = :workspaceId', { workspaceId });
  }

  /**
   * Row comparison `(a, b) > (x, y)` maps onto the composite index, unlike the
   * `a > x OR (a = x AND b > y)` form planners often refuse to range-scan.
   * Taking limit + 1 answers "is there another page" without a COUNT.
   */
  private keyset(
    qb: SelectQueryBuilder<Comment>,
    key: string,
    params: ListParams,
  ): SelectQueryBuilder<Comment> {
    const descending = params.order === 'newest';
    if (params.cursor) {
      qb.andWhere(`(${key}, c.id) ${descending ? '<' : '>'} (:cursorKey, :cursorId)`, {
        cursorKey: params.cursor.k,
        cursorId: params.cursor.id,
      });
    }
    return qb
      .orderBy(key, descending ? 'DESC' : 'ASC')
      .addOrderBy('c.id', descending ? 'DESC' : 'ASC')
      .take(params.limit + 1);
  }

  listTopLevel(postId: string, params: ListParams): Promise<Comment[]> {
    const qb = this.scoped(params.workspaceId)
      .andWhere('c.postId = :postId', { postId })
      .andWhere('c.depth = 0')
      .andWhere('c.deletedAt IS NULL');
    return this.keyset(qb, 'c.sortAt', params).getMany();
  }

  /**
   * Cross-post query over the mirror — the read that proxying to the platforms
   * could not answer at all, since it spans posts and accounts that live behind
   * different APIs with different pagination.
   */
  search(filters: SearchFilters, params: ListParams): Promise<Comment[]> {
    const qb = this.scoped(params.workspaceId).andWhere('c.deletedAt IS NULL');

    if (filters.postId) qb.andWhere('c.postId = :postId', { postId: filters.postId });
    if (filters.parentCommentId) {
      qb.andWhere('c.parentId = :parentId', { parentId: filters.parentCommentId });
    }
    if (filters.platform) qb.andWhere('c.platform = :platform', { platform: filters.platform });
    if (filters.since) qb.andWhere('c.sortAt >= :since', { since: filters.since });
    if (filters.until) qb.andWhere('c.sortAt <= :until', { until: filters.until });

    if (filters.unansweredOnly) {
      // Anti-join rather than a LEFT JOIN + IS NULL: Postgres stops at the first
      // matching reply instead of materialising every reply to every comment.
      qb.andWhere("c.origin = 'platform'")
        .andWhere('c.isFromOwner = false')
        .andWhere(
          `NOT EXISTS (
             SELECT 1 FROM comments r
              WHERE r.parent_id = c.id
                AND r.origin = 'blotato'
                AND r.deleted_at IS NULL
           )`,
        );
    }

    return this.keyset(qb, 'c.sortAt', params).getMany();
  }

  listReplies(parentId: string, params: ListParams): Promise<Comment[]> {
    const qb = this.scoped(params.workspaceId)
      .andWhere('c.parentId = :parentId', { parentId })
      .andWhere('c.deletedAt IS NULL');
    return this.keyset(qb, 'c.sortAt', params).getMany();
  }

  /** Every descendant, in reading order — one index range scan over the path. */
  listThread(root: Comment, params: ListParams): Promise<Comment[]> {
    const qb = this.scoped(params.workspaceId)
      .andWhere('c.postId = :postId', { postId: root.postId })
      .andWhere('c.path LIKE :pattern', { pattern: descendantPattern(root.path) })
      .andWhere('c.deletedAt IS NULL');
    return this.keyset(qb, 'c.path', { ...params, order: 'oldest' }).getMany();
  }

  findById(workspaceId: string, id: string): Promise<Comment | null> {
    return this.scoped(workspaceId).andWhere('c.id = :id', { id }).getOne();
  }

  findByPath(workspaceId: string, postId: string, path: string): Promise<Comment | null> {
    return this.scoped(workspaceId)
      .andWhere('c.postId = :postId', { postId })
      .andWhere('c.path = :path', { path })
      .getOne();
  }

  findByIdempotencyKey(workspaceId: string, key: string): Promise<Comment | null> {
    return this.scoped(workspaceId).andWhere('c.idempotencyKey = :key', { key }).getOne();
  }

  async findByPlatformIds(
    socialAccountId: string,
    platformCommentIds: string[],
  ): Promise<Map<string, Comment>> {
    if (platformCommentIds.length === 0) return new Map();
    const rows = await this.repo.find({
      where: { socialAccountId, platformCommentId: In(platformCommentIds) },
    });
    return new Map(rows.map((row) => [row.platformCommentId as string, row]));
  }

  create(data: Partial<Comment>): Comment {
    return this.repo.create(data);
  }

  save(comment: Comment): Promise<Comment> {
    return this.repo.save(comment);
  }

  /**
   * Re-polling the head of a thread replays pages constantly, so ON CONFLICT
   * makes that a no-op. Threading columns are never updated: rewriting a path
   * would invalidate every descendant's.
   */
  async upsertMirrored(comments: Comment[]): Promise<void> {
    if (comments.length === 0) return;

    await this.repo
      .createQueryBuilder()
      .insert()
      .into(Comment)
      // TypeORM's deep-partial insert type does not model jsonb columns; these are real entities.
      .values(comments as unknown as QueryDeepPartialEntity<Comment>[])
      .onConflict(
        `(social_account_id, platform_comment_id) WHERE platform_comment_id IS NOT NULL
         DO UPDATE SET
           body        = EXCLUDED.body,
           like_count  = EXCLUDED.like_count,
           reply_count = EXCLUDED.reply_count,
           raw         = EXCLUDED.raw,
           permalink   = COALESCE(EXCLUDED.permalink, comments.permalink),
           synced_at   = EXCLUDED.synced_at,
           updated_at  = now()`,
      )
      .execute();
  }

  /**
   * SKIP LOCKED lets any number of dispatchers drain the queue with no
   * coordination. Claiming also pushes next_attempt_at forward by a visibility
   * timeout, so a worker that dies releases its rows instead of stranding them —
   * which is why the predicate includes 'sending', not just 'pending'.
   */
  async claimDueReplies(limit: number, visibilitySeconds: number): Promise<Comment[]> {
    // TypeORM returns `[rows, affectedCount]` for UPDATE ... RETURNING on
    // Postgres, not the rows directly.
    const [claimed] = (await this.repo.query(
      `UPDATE comments
          SET delivery_status   = 'sending',
              delivery_attempts = delivery_attempts + 1,
              next_attempt_at   = now() + make_interval(secs => $2),
              updated_at        = now()
        WHERE id IN (
          SELECT id FROM comments
           WHERE delivery_status IN ('pending', 'sending')
             AND next_attempt_at <= now()
           ORDER BY next_attempt_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1
        )
        RETURNING id`,
      [limit, visibilitySeconds],
    )) as [{ id: string }[], number];

    if (claimed.length === 0) return [];
    return this.repo.find({ where: { id: In(claimed.map((row) => row.id)) } });
  }

  async markSent(
    id: string,
    platformCommentId: string,
    platformCreatedAt: Date,
    permalink: string | null,
  ): Promise<void> {
    await this.repo.update(id, {
      deliveryStatus: 'sent',
      platformCommentId,
      platformCreatedAt,
      permalink,
      nextAttemptAt: null,
      lastError: null,
      syncedAt: new Date(),
    });
  }

  async markRetry(
    id: string,
    nextAttemptAt: Date,
    error: { code: string; message: string; retryable: boolean },
  ): Promise<void> {
    await this.repo.update(id, { deliveryStatus: 'pending', nextAttemptAt, lastError: error });
  }

  async markFailed(
    id: string,
    error: { code: string; message: string; retryable: boolean },
  ): Promise<void> {
    await this.repo.update(id, { deliveryStatus: 'failed', nextAttemptAt: null, lastError: error });
  }
}
