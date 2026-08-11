import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Comment, CommentOrigin, DeliveryStatus } from '../entities/comment.entity';

class AuthorResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) handle!: string | null;
  @ApiProperty({ nullable: true }) displayName!: string | null;
  @ApiProperty({ nullable: true }) avatarUrl!: string | null;
}

class DeliveryResponse {
  @ApiProperty({ enum: ['pending', 'sending', 'sent', 'failed'] }) status!: DeliveryStatus;
  @ApiProperty() attempts!: number;
  @ApiPropertyOptional({ nullable: true })
  error!: { code: string; message: string; retryable: boolean } | null;
}

export class CommentResponse {
  @ApiProperty({ description: 'Blotato id — the only id to use in this API.' }) id!: string;
  @ApiProperty() postId!: string;
  @ApiProperty() platform!: string;

  @ApiProperty({ nullable: true, description: 'Null while an outgoing reply is undelivered.' })
  platformCommentId!: string | null;

  @ApiProperty({ nullable: true }) parentId!: string | null;
  @ApiProperty() rootId!: string;
  @ApiProperty({ description: '0 for a comment on the post, 1 for a reply to a comment.' })
  depth!: number;

  @ApiProperty() body!: string;
  @ApiProperty({ nullable: true, type: AuthorResponse }) author!: AuthorResponse | null;
  @ApiProperty() likeCount!: number;

  @ApiProperty({ description: 'Platform-reported; may exceed what we have mirrored.' })
  replyCount!: number;

  @ApiProperty() isFromOwner!: boolean;
  @ApiProperty({ nullable: true }) permalink!: string | null;

  @ApiProperty({ enum: ['platform', 'blotato'] }) origin!: CommentOrigin;

  @ApiProperty({ nullable: true, type: DeliveryResponse, description: 'Null for mirrored comments.' })
  delivery!: DeliveryResponse | null;

  @ApiProperty({ description: 'True when the platform’s nesting limit forced a shallower parent.' })
  wasReparented!: boolean;

  @ApiProperty({ description: 'Platform creation time, or acceptance time while pending.' })
  createdAt!: string;

  static from(comment: Comment): CommentResponse {
    const dto = new CommentResponse();
    dto.id = comment.id;
    dto.postId = comment.postId;
    dto.platform = comment.platform;
    dto.platformCommentId = comment.platformCommentId;
    dto.parentId = comment.parentId;
    dto.rootId = comment.rootId;
    dto.depth = comment.depth;
    dto.body = comment.body;
    dto.author = comment.author
      ? {
          id: comment.author.id,
          handle: comment.author.handle,
          displayName: comment.author.displayName,
          avatarUrl: comment.author.avatarUrl,
        }
      : null;
    dto.likeCount = comment.likeCount;
    dto.replyCount = comment.replyCount;
    dto.isFromOwner = comment.isFromOwner;
    dto.permalink = comment.permalink;
    dto.origin = comment.origin;
    dto.delivery = comment.deliveryStatus
      ? {
          status: comment.deliveryStatus,
          attempts: comment.deliveryAttempts,
          error: comment.lastError,
        }
      : null;
    dto.wasReparented = comment.wasReparented;
    dto.createdAt = (comment.sortAt ?? comment.platformCreatedAt ?? comment.createdAt).toISOString();
    return dto;
  }
}

export class CommentListResponse {
  @ApiProperty({ type: [CommentResponse] }) data!: CommentResponse[];

  @ApiProperty({ nullable: true, description: 'Pass back as ?cursor. Null when exhausted.' })
  nextCursor!: string | null;

  @ApiPropertyOptional({ description: 'Mirror freshness. Stale data is still returned.' })
  meta?: { syncedAt: string | null; stale: boolean; syncError?: { code: string; message: string } };
}
