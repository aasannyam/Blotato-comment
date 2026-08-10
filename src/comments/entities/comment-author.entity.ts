import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Deduplicated per platform so a prolific commenter's handle is not copied onto
 * every comment row. Global rather than per workspace: the same public account
 * comments on posts belonging to different customers.
 */
@Entity('comment_authors')
@Index('uq_comment_authors_platform_user', ['platform', 'platformUserId'], { unique: true })
export class CommentAuthor {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('text')
  platform!: string;

  @Column('text', { name: 'platform_user_id' })
  platformUserId!: string;

  @Column('text', { nullable: true })
  handle!: string | null;

  @Column('text', { name: 'display_name', nullable: true })
  displayName!: string | null;

  @Column('text', { name: 'avatar_url', nullable: true })
  avatarUrl!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
