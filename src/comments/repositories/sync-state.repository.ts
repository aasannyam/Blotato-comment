import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CommentSyncState } from '../entities/comment-sync-state.entity';

@Injectable()
export class SyncStateRepository {
  constructor(
    @InjectRepository(CommentSyncState) private readonly repo: Repository<CommentSyncState>,
  ) {}

  findByPostId(postId: string): Promise<CommentSyncState | null> {
    return this.repo.findOne({ where: { postId } });
  }

  create(data: Partial<CommentSyncState>): CommentSyncState {
    return this.repo.create(data);
  }

  save(state: CommentSyncState): Promise<CommentSyncState> {
    return this.repo.save(state);
  }

  async claimDue(limit: number, visibilitySeconds: number): Promise<CommentSyncState[]> {
    // TypeORM returns `[rows, affectedCount]` for UPDATE ... RETURNING on Postgres.
    const [claimed] = (await this.repo.query(
      `UPDATE comment_sync_state
          SET next_poll_at = now() + make_interval(secs => $2),
              updated_at   = now()
        WHERE post_id IN (
          SELECT post_id FROM comment_sync_state
           WHERE next_poll_at IS NOT NULL
             AND next_poll_at <= now()
           ORDER BY next_poll_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1
        )
        RETURNING post_id`,
      [limit, visibilitySeconds],
    )) as [{ post_id: string }[], number];

    if (claimed.length === 0) return [];
    return this.repo.find({ where: { postId: In(claimed.map((row) => row.post_id)) } });
  }
}
