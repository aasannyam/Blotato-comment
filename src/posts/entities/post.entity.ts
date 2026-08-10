import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SocialAccount } from './social-account.entity';

/**
 * One published post on one platform. A scheduled item fanned out to four
 * platforms is four rows, because a comment thread only exists per platform.
 */
@Entity('posts')
@Index(['workspaceId', 'publishedAt'])
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'workspace_id' })
  workspaceId!: string;

  @Column('uuid', { name: 'social_account_id' })
  socialAccountId!: string;

  @ManyToOne(() => SocialAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'social_account_id' })
  socialAccount?: SocialAccount;

  /** Denormalised from the account so comment queries never need the join. */
  @Column('text')
  platform!: string;

  @Column('text', { name: 'platform_post_id', nullable: true })
  platformPostId!: string | null;

  @Column('timestamptz', { name: 'published_at', nullable: true })
  publishedAt!: Date | null;

  @Column('text', { nullable: true })
  permalink!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  isPublished(): this is Post & { platformPostId: string } {
    return this.platformPostId !== null && this.publishedAt !== null;
  }
}
