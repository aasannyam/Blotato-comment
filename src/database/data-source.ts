// The TypeORM CLI boots this file directly, outside Nest, so nothing else loads
// .env for it. Without this the CLI silently falls back to the default URL and
// runs migrations against whatever Postgres answers there.
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { CommentAuthor } from '../comments/entities/comment-author.entity';
import { CommentSyncState } from '../comments/entities/comment-sync-state.entity';
import { Comment } from '../comments/entities/comment.entity';
import { Post } from '../posts/entities/post.entity';
import { SocialAccount } from '../posts/entities/social-account.entity';
import { DEFAULT_DATABASE_URL } from '../common/config/configuration';

export const entities = [SocialAccount, Post, CommentAuthor, Comment, CommentSyncState];

/**
 * Standalone data source for the TypeORM CLI (migrations).
 *
 * `synchronize` is off everywhere, including development. Schema changes go
 * through reviewed migrations — the generated-schema shortcut cannot express the
 * partial indexes, generated column and check constraints this design relies on,
 * and would silently drop them.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  entities,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
