import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Kept out of `posts` because it churns on every sync tick. */
@Entity('comment_sync_state')
@Index('ix_sync_state_due', ['nextPollAt'])
export class CommentSyncState {
  @PrimaryColumn('uuid', { name: 'post_id' })
  postId!: string;

  @Column('uuid', { name: 'workspace_id' })
  workspaceId!: string;

  @Column('text')
  platform!: string;

  @Column('timestamptz', { name: 'last_synced_at', nullable: true })
  lastSyncedAt!: Date | null;

  @Column('timestamptz', { name: 'next_poll_at', nullable: true })
  nextPollAt!: Date | null;

  @Column('int', { name: 'consecutive_failures', default: 0 })
  consecutiveFailures!: number;

  @Column('jsonb', { name: 'last_error', nullable: true })
  lastError!: { code: string; message: string } | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
