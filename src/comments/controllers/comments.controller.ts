import { Body, Controller, Get, Headers, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { WorkspaceId } from '../../common/auth/workspace.decorator';
import { CommentsService } from '../services/comments.service';
import { CommentListResponse, CommentResponse } from '../dto/comment.response';
import { CreateReplyDto } from '../dto/create-reply.dto';
import { ListCommentsQuery } from '../dto/list-comments.query';
import { SearchCommentsQuery } from '../dto/search-comments.query';
import { RepliesService } from '../services/replies.service';

@ApiTags('comments')
@ApiHeader({ name: 'X-Workspace-Id', required: true })
@Controller('v1/comments')
export class CommentsController {
  constructor(
    private readonly comments: CommentsService,
    private readonly replies: RepliesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Search comments across posts and platforms',
    description:
      'Flat collection over the mirror. Every filter is optional and combinable, so one route ' +
      'serves "this post", "replies to this comment", "everything on Instagram last week" and ' +
      '`unansweredOnly=true`, the moderation queue — none of which a single platform API ' +
      'could answer, since they span accounts that paginate differently. Reads only cached ' +
      'data: `?refresh=true` is on the per-post route, where one post bounds the sync cost.',
  })
  @ApiResponse({ status: 200, type: CommentListResponse })
  async search(
    @WorkspaceId() workspaceId: string,
    @Query() query: SearchCommentsQuery,
  ): Promise<CommentListResponse> {
    const page = await this.comments.searchComments(
      workspaceId,
      {
        postId: query.postId,
        parentCommentId: query.parentCommentId,
        platform: query.platform,
        since: query.since ? new Date(query.since) : undefined,
        until: query.until ? new Date(query.until) : undefined,
        unansweredOnly: query.unansweredOnly,
      },
      query,
    );
    return { data: page.data.map(CommentResponse.from), nextCursor: page.nextCursor };
  }

  @Get(':commentId')
  @ApiOperation({
    summary: 'Fetch one comment',
    description: 'Also the polling target for a queued reply: `delivery.status` moves pending → sent or failed.',
  })
  @ApiResponse({ status: 200, type: CommentResponse })
  async get(
    @WorkspaceId() workspaceId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<CommentResponse> {
    return CommentResponse.from(await this.comments.getComment(workspaceId, commentId));
  }

  @Get(':commentId/replies')
  @ApiOperation({ summary: 'List direct replies to a comment' })
  @ApiResponse({ status: 200, type: CommentListResponse })
  async listReplies(
    @WorkspaceId() workspaceId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Query() query: ListCommentsQuery,
  ): Promise<CommentListResponse> {
    const page = await this.comments.listReplies(workspaceId, commentId, query);
    return { data: page.data.map(CommentResponse.from), nextCursor: page.nextCursor };
  }

  @Get(':commentId/thread')
  @ApiOperation({
    summary: 'List every descendant of a comment, in reading order',
    description:
      'One request for a whole conversation at any depth, ordered so a client can render it ' +
      'by tracking `depth` alone. For platforms like X, where walking level by level would ' +
      'be a request per node.',
  })
  @ApiResponse({ status: 200, type: CommentListResponse })
  async listThread(
    @WorkspaceId() workspaceId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Query() query: ListCommentsQuery,
  ): Promise<CommentListResponse> {
    const page = await this.comments.listThread(workspaceId, commentId, query);
    return { data: page.data.map(CommentResponse.from), nextCursor: page.nextCursor };
  }

  @Post(':commentId/replies')
  @ApiOperation({
    summary: 'Reply to a comment',
    description:
      'Queued for delivery: 202 with the reply in `pending` so it can render immediately, or ' +
      '200 on an idempotent replay. If the platform’s nesting limit forces a shallower ' +
      'parent, the response carries `wasReparented: true` and a different `parentId`.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiResponse({ status: 202, type: CommentResponse })
  @ApiResponse({ status: 422, description: 'Body exceeds the platform’s character limit.' })
  async reply(
    @WorkspaceId() workspaceId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: CreateReplyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CommentResponse> {
    const outcome = await this.replies.createReply({
      workspaceId,
      parentCommentId: commentId,
      body: dto.body,
      idempotencyKey,
    });

    res.status(outcome.replayed ? HttpStatus.OK : HttpStatus.ACCEPTED);
    res.setHeader('Location', `/v1/comments/${outcome.comment.id}`);
    return CommentResponse.from(outcome.comment);
  }
}
