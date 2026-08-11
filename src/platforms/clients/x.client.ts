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
import { PlatformError } from '../platform.errors';
import { TokenVault } from '../token-vault.service';
import { platformFetch } from './http';

const API = 'https://api.x.com/2';

interface XTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: { like_count: number; reply_count: number };
  referenced_tweets?: { type: string; id: string }[];
}

interface XSearchResponse {
  data?: XTweet[];
  includes?: { users?: { id: string; username: string; name: string; profile_image_url?: string }[] };
  meta?: { next_token?: string };
}

@Injectable()
export class XCommentClient implements PlatformCommentClient {
  readonly platform = 'x';

  readonly capabilities: PlatformCapabilities = {
    maxThreadDepth: null, // arbitrary nesting; never re-parented
    maxBodyLength: 280,
    supportsWebhooks: false,
    mentionOnReparent: false,
  };

  constructor(private readonly vault: TokenVault) {}

  async fetchComments(ctx: PlatformContext, params: FetchCommentsParams): Promise<FetchCommentsPage> {
    const token = await this.vault.getAccessToken(ctx.credentialRef, this.platform);

    // One paged search returns every depth; nesting rebuilt from `referenced_tweets`.
    const url = new URL(`${API}/tweets/search/recent`);
    url.searchParams.set('query', `conversation_id:${params.platformPostId}`);
    url.searchParams.set('max_results', String(Math.min(params.limit, 100)));
    url.searchParams.set('tweet.fields', 'created_at,author_id,public_metrics,referenced_tweets');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'username,name,profile_image_url');
    if (params.cursor) url.searchParams.set('next_token', params.cursor);

    const res = await platformFetch<XSearchResponse>({
      platform: this.platform,
      url: url.toString(),
      token,
    });

    const users = new Map((res.includes?.users ?? []).map((u) => [u.id, u]));

    const comments = (res.data ?? []).map((tweet): RawPlatformComment => {
      const author = users.get(tweet.author_id);
      const repliedTo = tweet.referenced_tweets?.find((r) => r.type === 'replied_to');
      return {
        platformCommentId: tweet.id,
        // Replying to the post itself is top-level; anything else nests.
        parentPlatformCommentId:
          repliedTo && repliedTo.id !== params.platformPostId ? repliedTo.id : null,
        body: tweet.text,
        author: {
          platformUserId: tweet.author_id,
          handle: author?.username ?? null,
          displayName: author?.name ?? null,
          avatarUrl: author?.profile_image_url ?? null,
        },
        createdAt: new Date(tweet.created_at),
        likeCount: tweet.public_metrics?.like_count ?? null,
        replyCount: tweet.public_metrics?.reply_count ?? null,
        isFromOwner: tweet.author_id === ctx.platformAccountId,
        permalink: author ? `https://x.com/${author.username}/status/${tweet.id}` : null,
        raw: tweet as unknown as Record<string, unknown>,
      };
    });

    return { comments, nextCursor: res.meta?.next_token ?? null };
  }

  async publishReply(ctx: PlatformContext, params: PublishReplyParams): Promise<PublishReplyResult> {
    const token = await this.vault.getAccessToken(ctx.credentialRef, this.platform);

    const res = await platformFetch<{ data?: { id: string } }>({
      platform: this.platform,
      url: `${API}/tweets`,
      method: 'POST',
      token,
      body: {
        text: params.body,
        reply: { in_reply_to_tweet_id: params.parentPlatformCommentId ?? params.platformPostId },
      },
    });

    if (!res.data?.id) {
      // 2xx with no id: the tweet exists, so retrying would post it twice.
      throw new PlatformError({
        code: 'UNCONFIRMED_WRITE',
        platform: this.platform,
        message: 'reply accepted but no tweet id returned',
      });
    }

    // X returns no creation timestamp on write; the next sync corrects it.
    return { platformCommentId: res.data.id, createdAt: new Date(), permalink: null };
  }
}
