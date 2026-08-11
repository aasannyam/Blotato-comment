import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommentNotFoundException } from '../../common/errors/domain.exception';
import { Page, buildPage, decodeCursor } from '../../common/pagination/cursor';
import { PlatformError } from '../../platforms/platform.errors';
import { PostsService } from '../../posts/posts.service';
import { CommentSyncService } from './comment-sync.service';
import { CommentsRepository, SearchFilters, SortOrder } from '../repositories/comments.repository';
import { CommentSyncState } from '../entities/comment-sync-state.entity';
import { Comment } from '../entities/comment.entity';

export interface ListQuery {
  limit: number;
  cursor?: string;
  order: SortOrder;
  refresh?: boolean;
}

export interface MirrorMeta {
  syncedAt: string | null;
  stale: boolean;
  syncError?: { code: string; message: string };
}

export interface CommentPage extends Page<Comment> {
  meta: MirrorMeta;
}

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);
  private readonly staleAfterSeconds: number;

  constructor(
    private readonly comments: CommentsRepository,
    private readonly posts: PostsService,
    private readonly sync: CommentSyncService,
    @InjectRepository(CommentSyncState) private readonly syncState: Repository<CommentSyncState>,
    config: ConfigService,
  ) {
    this.staleAfterSeconds = config.get<number>('comments.staleAfterSeconds', 120);
  }

  /**
   * Served from our mirror rather than proxied. Proxying would inherit the
   * platform's latency and downtime on every read, spend a per-account rate
   * limit that publishing also needs, and make a unified cursor impossible
   * across platforms that paginate differently. The cost is staleness, so
   * staleness is reported in `meta` instead of hidden.
   */
  async listPostComments(
    workspaceId: string,
    postId: string,
    query: ListQuery,
  ): Promise<CommentPage> {
    const ctx = await this.posts.getPublishedPost(workspaceId, postId);

    let syncError: MirrorMeta['syncError'];
    if (query.refresh) {
      try {
        await this.sync.syncPost(ctx, 1);
      } catch (error) {
        // Degrade to cached data: slightly stale comments beat a 502, as long
        // as the response says so.
        syncError = {
          code: error instanceof PlatformError ? error.code : 'UNKNOWN',
          message: error instanceof Error ? error.message : 'refresh failed',
        };
        this.logger.warn(`Refresh failed for post ${postId}: ${syncError.code}`);
      }
    }

    const rows = await this.comments.listTopLevel(postId, {
      workspaceId,
      limit: query.limit,
      cursor: query.cursor ? decodeCursor(query.cursor) : null,
      order: query.order,
    });

    const page = buildPage(rows, query.limit, (row) => ({
      k: row.sortAt.toISOString(),
      id: row.id,
    }));

    return { ...page, meta: await this.meta(postId, syncError) };
  }

  /**
   * The read that only exists because comments are mirrored: it spans posts and
   * platforms, so no single upstream API could serve it. `unansweredOnly` turns
   * it into a moderation queue over everything the workspace has published.
   *
   * Deliberately carries no `meta` — staleness is per post, and a page here can
   * mix posts synced at different times, so one flag would be meaningless.
   */
  async searchComments(
    workspaceId: string,
    filters: SearchFilters,
    query: ListQuery,
  ): Promise<Page<Comment>> {
    const rows = await this.comments.search(filters, {
      workspaceId,
      limit: query.limit,
      cursor: query.cursor ? decodeCursor(query.cursor) : null,
      order: query.order,
    });
    return buildPage(rows, query.limit, (row) => ({ k: row.sortAt.toISOString(), id: row.id }));
  }

  async listReplies(
    workspaceId: string,
    commentId: string,
    query: ListQuery,
  ): Promise<Page<Comment>> {
    const parent = await this.getComment(workspaceId, commentId);
    const rows = await this.comments.listReplies(parent.id, {
      workspaceId,
      limit: query.limit,
      cursor: query.cursor ? decodeCursor(query.cursor) : null,
      order: query.order,
    });
    return buildPage(rows, query.limit, (row) => ({ k: row.sortAt.toISOString(), id: row.id }));
  }

  /** One request for a whole conversation, instead of one per level on X. */
  async listThread(
    workspaceId: string,
    commentId: string,
    query: ListQuery,
  ): Promise<Page<Comment>> {
    const root = await this.getComment(workspaceId, commentId);
    const rows = await this.comments.listThread(root, {
      workspaceId,
      limit: query.limit,
      cursor: query.cursor ? decodeCursor(query.cursor) : null,
      order: 'oldest',
    });
    // Ordered by path, so the cursor is the path.
    return buildPage(rows, query.limit, (row) => ({ k: row.path, id: row.id }));
  }

  async getComment(workspaceId: string, commentId: string): Promise<Comment> {
    const comment = await this.comments.findById(workspaceId, commentId);
    if (!comment) throw new CommentNotFoundException(commentId);
    return comment;
  }

  private async meta(postId: string, syncError?: MirrorMeta['syncError']): Promise<MirrorMeta> {
    const state = await this.syncState.findOne({ where: { postId } });
    const syncedAt = state?.lastSyncedAt ?? null;

    return {
      syncedAt: syncedAt?.toISOString() ?? null,
      stale: syncedAt === null || Date.now() - syncedAt.getTime() > this.staleAfterSeconds * 1000,
      ...(syncError ? { syncError } : {}),
    };
  }
}
