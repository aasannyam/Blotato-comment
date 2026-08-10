import { Body, Controller, Get, Headers, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { WorkspaceId } from '../common/auth/workspace.decorator';
import { CommentsService } from './comments.service';
import { CommentListResponse, CommentResponse } from './dto/comment.response';
import { CreateReplyDto } from './dto/create-reply.dto';
import { ListCommentsQuery } from './dto/list-comments.query';
import { RepliesService } from './replies.service';

/**
 * Comments are nested under the post because a comment has no meaning without
 * one. Individual comments get their own top-level resource once you know an id.
 */
@ApiTags('comments')
@ApiHeader({ name: 'X-Workspace-Id', required: true })
@Controller('v1/posts/:postId/comments')
export class PostCommentsController {
  constructor(
    private readonly comments: CommentsService,
    private readonly replies: RepliesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List top-level comments on a published post',
    description:
      'Served from Blotato’s mirror. Replies are not inlined — fetch them per comment, or a ' +
      'whole subtree via /thread — so page size stays predictable however deep a thread runs.',
  })
  @ApiResponse({ status: 200, type: CommentListResponse })
  async list(
    @WorkspaceId() workspaceId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Query() query: ListCommentsQuery,
  ): Promise<CommentListResponse> {
    const page = await this.comments.listPostComments(workspaceId, postId, query);
    return { data: page.data.map(CommentResponse.from), nextCursor: page.nextCursor, meta: page.meta };
  }

  @Post()
  @ApiOperation({
    summary: 'Comment on your own published post',
    description: 'Queued for delivery: 202 with the comment in `pending`, or 200 on an idempotent replay.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiResponse({ status: 202, type: CommentResponse })
  async create(
    @WorkspaceId() workspaceId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: CreateReplyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CommentResponse> {
    const outcome = await this.replies.createReply({
      workspaceId,
      postId,
      body: dto.body,
      idempotencyKey,
    });

    res.status(outcome.replayed ? HttpStatus.OK : HttpStatus.ACCEPTED);
    res.setHeader('Location', `/v1/comments/${outcome.comment.id}`);
    return CommentResponse.from(outcome.comment);
  }
}
