import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsISO8601, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

/**
 * Filters for the flat collection. Every field is optional, so the bare
 * endpoint is "all comments in this workspace" and each parameter narrows it.
 */
export class SearchCommentsQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;

  @ApiPropertyOptional({ description: 'Opaque cursor from a previous response.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ enum: ['oldest', 'newest'], default: 'newest' })
  @IsOptional()
  @IsIn(['oldest', 'newest'])
  order: 'oldest' | 'newest' = 'newest';

  @ApiPropertyOptional({ description: 'Restrict to one post.' })
  @IsOptional()
  @IsUUID()
  postId?: string;

  @ApiPropertyOptional({ description: 'Restrict to direct replies to one comment.' })
  @IsOptional()
  @IsUUID()
  parentCommentId?: string;

  @ApiPropertyOptional({ description: 'Restrict to one platform, e.g. `instagram`.' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: 'ISO 8601. Inclusive lower bound on comment time.' })
  @IsOptional()
  @IsISO8601()
  since?: string;

  @ApiPropertyOptional({ description: 'ISO 8601. Inclusive upper bound on comment time.' })
  @IsOptional()
  @IsISO8601()
  until?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Only comments from other people that we have not replied to yet — the moderation ' +
      'queue. Excludes our own comments and any already carrying a reply of ours.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === true || value === 'true'))
  @IsBoolean()
  unansweredOnly?: boolean;
}
