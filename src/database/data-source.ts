// The TypeORM CLI boots this outside Nest, so nothing else loads .env for it.
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { CommentAuthor } from '../comments/entities/comment-author.entity';
import { CommentSyncState } from '../comments/entities/comment-sync-state.entity';
import { Comment } from '../comments/entities/comment.entity';
import { Post } from '../posts/entities/post.entity';
import { SocialAccount } from '../posts/entities/social-account.entity';
import { DEFAULT_DATABASE_URL } from '../common/config/configuration';

export const entities = [SocialAccount, Post, CommentAuthor, Comment, CommentSyncState];

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  entities,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
