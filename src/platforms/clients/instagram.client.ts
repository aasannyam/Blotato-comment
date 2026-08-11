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
import { TokenVault } from '../token-vault.service';
import { platformFetch } from './http';

const API = 'https://graph.facebook.com/v21.0';

interface IgPaging {
  cursors?: { after?: string };
  next?: string;
}

interface IgComment {
  id: string;
  text: string;
  timestamp: string;
  username?: string;
  from?: { id?: string; username?: string };
  like_count?: number;
  replies?: { data: IgComment[]; paging?: IgPaging };
}

const REPLY_FIELDS = 'id,text,timestamp,username,like_count,from';

// Guards against a pathological thread turning one sync into unbounded calls.
const MAX_REPLY_PAGES = 10;

@Injectable()
export class InstagramCommentClient implements PlatformCommentClient {
  readonly platform = 'instagram';

  readonly capabilities: PlatformCapabilities = {
    maxThreadDepth: 1,
    maxBodyLength: 2200,
    supportsWebhooks: true,
    mentionOnReparent: true,
  };

  constructor(private readonly vault: TokenVault) {}

  async fetchComments(ctx: PlatformContext, params: FetchCommentsParams): Promise<FetchCommentsPage> {
    const token = await this.vault.getAccessToken(ctx.credentialRef, this.platform);

    const url = new URL(`${API}/${params.platformPostId}/comments`);
    url.searchParams.set(
      'fields',
      `${REPLY_FIELDS},replies{${REPLY_FIELDS}}`,
    );
    url.searchParams.set('limit', String(params.limit));
    if (params.cursor) url.searchParams.set('after', params.cursor);

    const res = await platformFetch<{ data?: IgComment[]; paging?: IgPaging }>({
      platform: this.platform,
      url: url.toString(),
      token,
    });

    const comments: RawPlatformComment[] = [];
    for (const top of res.data ?? []) {
      comments.push(this.normalize(top, null, ctx));
      for (const reply of top.replies?.data ?? []) {
        comments.push(this.normalize(reply, top.id, ctx));
      }

      // The nested expansion is capped by Graph, so a busy thread arrives
      // truncated. Left unfollowed the mirror silently loses replies while
      // still reporting itself fresh.
      if (top.replies?.paging?.next) {
        for (const reply of await this.fetchRemainingReplies(top, token, ctx)) {
          comments.push(reply);
        }
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

  private async fetchRemainingReplies(
    top: IgComment,
    token: string,
    ctx: PlatformContext,
  ): Promise<RawPlatformComment[]> {
    const out: RawPlatformComment[] = [];
    let after = top.replies?.paging?.cursors?.after ?? null;

    for (let page = 0; page < MAX_REPLY_PAGES && after; page++) {
      const url = new URL(`${API}/${top.id}/replies`);
      url.searchParams.set('fields', REPLY_FIELDS);
      url.searchParams.set('limit', '50');
      url.searchParams.set('after', after);

      const res = await platformFetch<{ data?: IgComment[]; paging?: IgPaging }>({
        platform: this.platform,
        url: url.toString(),
        token,
      });

      for (const reply of res.data ?? []) out.push(this.normalize(reply, top.id, ctx));
      after = res.paging?.next ? (res.paging.cursors?.after ?? null) : null;
    }

    return out;
  }

  private normalize(
    comment: IgComment,
    parentId: string | null,
    ctx: PlatformContext,
  ): RawPlatformComment {
    // Graph omits `from` on comments from other users. Falling back to a
    // username put a handle in the same field as an account id: owner checks
    // compared two namespaces, and a shared 'unknown' merged distinct authors.
    const username = comment.username ?? comment.from?.username ?? null;
    const platformUserId = comment.from?.id
      ? comment.from.id
      : username
        ? `username:${username}`
        : `comment:${comment.id}`;

    return {
      platformCommentId: comment.id,
      parentPlatformCommentId: parentId,
      body: comment.text,
      author: {
        platformUserId,
        handle: username,
        displayName: username,
        avatarUrl: null,
      },
      createdAt: new Date(comment.timestamp),
      likeCount: comment.like_count ?? null,
      replyCount: comment.replies?.data.length ?? null,
      // Only a real account id can establish ownership; a handle match cannot.
      isFromOwner: comment.from?.id === ctx.platformAccountId,
      permalink: null,
      raw: comment as unknown as Record<string, unknown>,
    };
  }
}
