import { Injectable } from '@nestjs/common';
import {
  FetchCommentsPage,
  FetchCommentsParams,
  PlatformCapabilities,
  PlatformCommentClient,
  PlatformContext,
  PublishReplyParams,
  PublishReplyResult,
  RawPlatformComment,
} from '../platform-client.interface';
import { TokenVaultService } from '../token-vault.service';
import { platformFetch } from './http';

const API = 'https://graph.facebook.com/v21.0';

interface IgComment {
  id: string;
  text: string;
  timestamp: string;
  username?: string;
  from?: { id?: string; username?: string };
  like_count?: number;
  replies?: { data: IgComment[] };
}

@Injectable()
export class InstagramCommentClient implements PlatformCommentClient {
  readonly platform = 'instagram';

  readonly capabilities: PlatformCapabilities = {
    maxThreadDepth: 1,
    maxBodyLength: 2200,
    supportsWebhooks: true,
    mentionOnReparent: true,
  };

  constructor(private readonly vault: TokenVaultService) {}

  async fetchComments(ctx: PlatformContext, params: FetchCommentsParams): Promise<FetchCommentsPage> {
    const token = await this.vault.getAccessToken(ctx.credentialRef, this.platform);

    const url = new URL(`${API}/${params.platformPostId}/comments`);
    url.searchParams.set(
      'fields',
      'id,text,timestamp,username,like_count,from,replies{id,text,timestamp,username,like_count,from}',
    );
    url.searchParams.set('limit', String(params.limit));
    if (params.cursor) url.searchParams.set('after', params.cursor);

    const res = await platformFetch<{
      data?: IgComment[];
      paging?: { cursors?: { after?: string }; next?: string };
    }>({ platform: this.platform, url: url.toString(), token });

    // Replies arrive nested in the same response, so a page covers whole threads.
    const comments: RawPlatformComment[] = [];
    for (const top of res.data ?? []) {
      comments.push(this.normalize(top, null, ctx));
      for (const reply of top.replies?.data ?? []) {
        comments.push(this.normalize(reply, top.id, ctx));
      }
    }

    // Graph returns an `after` cursor even on the last page; `next` is the real signal.
    return { comments, nextCursor: res.paging?.next ? (res.paging.cursors?.after ?? null) : null };
  }

  async publishReply(ctx: PlatformContext, params: PublishReplyParams): Promise<PublishReplyResult> {
    const token = await this.vault.getAccessToken(ctx.credentialRef, this.platform);

    const url = params.parentPlatformCommentId
      ? `${API}/${params.parentPlatformCommentId}/replies`
      : `${API}/${params.platformPostId}/comments`;

    const res = await platformFetch<{ id: string }>({
      platform: this.platform,
      url,
      method: 'POST',
      token,
      body: { message: params.body },
    });

    return { platformCommentId: res.id, createdAt: new Date(), permalink: null };
  }

  private normalize(
    comment: IgComment,
    parentId: string | null,
    ctx: PlatformContext,
  ): RawPlatformComment {
    const authorId = comment.from?.id ?? comment.username ?? 'unknown';
    return {
      platformCommentId: comment.id,
      parentPlatformCommentId: parentId,
      body: comment.text,
      author: {
        platformUserId: authorId,
        handle: comment.username ?? comment.from?.username ?? null,
        displayName: comment.from?.username ?? comment.username ?? null,
        avatarUrl: null,
      },
      createdAt: new Date(comment.timestamp),
      likeCount: comment.like_count ?? null,
      replyCount: comment.replies?.data.length ?? null,
      isFromOwner: authorId === ctx.platformAccountId,
      permalink: null,
      raw: comment as unknown as Record<string, unknown>,
    };
  }
}
