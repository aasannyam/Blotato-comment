import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommentAuthor } from '../entities/comment-author.entity';

export interface AuthorInput {
  platform: string;
  platformUserId: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

function key(platform: string, platformUserId: string): string {
  return `${platform}:${platformUserId}`;
}

@Injectable()
export class CommentAuthorsRepository {
  constructor(@InjectRepository(CommentAuthor) private readonly repo: Repository<CommentAuthor>) {}

  async ensureMany(inputs: AuthorInput[]): Promise<Map<string, CommentAuthor>> {
    const unique = new Map(inputs.map((i) => [key(i.platform, i.platformUserId), i]));
    if (unique.size === 0) return new Map();

    await this.repo
      .createQueryBuilder()
      .insert()
      .into(CommentAuthor)
      .values([...unique.values()])
      .onConflict(
        `(platform, platform_user_id) DO UPDATE SET
           handle       = COALESCE(EXCLUDED.handle, comment_authors.handle),
           display_name = COALESCE(EXCLUDED.display_name, comment_authors.display_name),
           avatar_url   = COALESCE(EXCLUDED.avatar_url, comment_authors.avatar_url),
           updated_at   = now()`,
      )
      .execute();

    const rows = await this.repo.find({
      where: [...unique.values()].map((i) => ({
        platform: i.platform,
        platformUserId: i.platformUserId,
      })),
    });

    return new Map(rows.map((a) => [key(a.platform, a.platformUserId), a]));
  }

  async ensure(input: AuthorInput): Promise<CommentAuthor> {
    const authors = await this.ensureMany([input]);
    return authors.get(key(input.platform, input.platformUserId))!;
  }
}
