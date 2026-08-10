import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CommentAuthor } from './comment-author.entity';

export type CommentOrigin = 'platform' | 'blotato';
export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed';

/**
 * Mirrored comments and outbound replies share one table: an undelivered reply
 * still has to appear in its thread, in position, the instant it is written.
 * Splitting them would force every read path to union two sources.
 */
@Entity('comments')
@Index('ix_comments_post_thread', ['postId', 'depth', 'sortAt', 'id'])
@Index('ix_comments_parent', ['parentId', 'sortAt', 'id'])
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Denormalised onto every row so no read path can omit the tenant predicate. */
  @Column('uuid', { name: 'workspace_id' })
  workspaceId!: string;

  @Column('uuid', { name: 'post_id' })
  postId!: string;

  @Column('uuid', { name: 'social_account_id' })
  socialAccountId!: string;

  @Column('text')
  platform!: string;

  /** Null until an outbound reply is delivered, which makes "pending" queryable. */
  @Column('text', { name: 'platform_comment_id', nullable: true })
  platformCommentId!: string | null;

  @Column('uuid', { name: 'parent_id', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => Comment, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent?: Comment | null;

  @Column('uuid', { name: 'root_id' })
  rootId!: string;

  @Column('int')
  depth!: number;

  /** With root_id and depth, turns any subtree into one indexed range scan. */
  @Column('text')
  path!: string;

  @Column('uuid', { name: 'author_id', nullable: true })
  authorId!: string | null;

  @ManyToOne(() => CommentAuthor, { nullable: true })
  @JoinColumn({ name: 'author_id' })
  author?: CommentAuthor | null;

  @Column('text')
  body!: string;

  @Column('int', { name: 'like_count', default: 0 })
  likeCount!: number;

  /** Platform-reported; can exceed what we mirrored, so clients know to page. */
  @Column('int', { name: 'reply_count', default: 0 })
  replyCount!: number;

  @Column('boolean', { name: 'is_from_owner', default: false })
  isFromOwner!: boolean;

  @Column('text', { nullable: true })
  permalink!: string | null;

  @Column('jsonb', { default: () => "'{}'::jsonb" })
  raw!: Record<string, unknown>;

  @Column('timestamptz', { name: 'platform_created_at', nullable: true })
  platformCreatedAt!: Date | null;

  /**
   * Generated `COALESCE(platform_created_at, created_at)`: one sort key, so a
   * pending reply orders correctly and does not jump position once delivered.
   */
  @Column({ type: 'timestamptz', name: 'sort_at', insert: false, update: false })
  sortAt!: Date;

  @Column('timestamptz', { name: 'synced_at', nullable: true })
  syncedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /** Soft delete: hard-deleting would orphan replies to a comment removed upstream. */
  @Column('timestamptz', { name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @Column('text', { default: 'platform' })
  origin!: CommentOrigin;

  @Column('text', { name: 'delivery_status', nullable: true })
  deliveryStatus!: DeliveryStatus | null;

  @Column('int', { name: 'delivery_attempts', default: 0 })
  deliveryAttempts!: number;

  @Column('timestamptz', { name: 'next_attempt_at', nullable: true })
  nextAttemptAt!: Date | null;

  @Column('jsonb', { name: 'last_error', nullable: true })
  lastError!: { code: string; message: string; retryable: boolean } | null;

  @Column('text', { name: 'idempotency_key', nullable: true })
  idempotencyKey!: string | null;

  /** Hash of the request, compared on replay to detect key reuse with a different body. */
  @Column('text', { name: 'request_fingerprint', nullable: true })
  requestFingerprint!: string | null;

  @Column('boolean', { name: 'was_reparented', default: false })
  wasReparented!: boolean;
}
