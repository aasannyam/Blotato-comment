import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * ASSUMPTION: this exists in Blotato in a richer form. The comment system
 * depends on these fields and nothing else.
 */
@Entity('social_accounts')
@Index(['workspaceId', 'platform'])
export class SocialAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'workspace_id' })
  workspaceId!: string;

  @Column('text')
  platform!: string;

  /** The account's id on the platform; used to detect our own comments. */
  @Column('text', { name: 'platform_account_id' })
  platformAccountId!: string;

  @Column('text', { name: 'handle', nullable: true })
  handle!: string | null;

  /** Pointer into the secrets store, never a token. */
  @Column('text', { name: 'credential_ref' })
  credentialRef!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
