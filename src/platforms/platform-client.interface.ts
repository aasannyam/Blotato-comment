/** Open set of strings, not a union or PG enum — new platforms need no migration. */
export type PlatformId = string;

/** Domain code branches on these, never on `platform === 'instagram'`. */
export interface PlatformCapabilities {
  readonly maxThreadDepth: number | null;
  readonly maxBodyLength: number;
  readonly supportsWebhooks: boolean;
  /** Prefix a re-parented reply with the target's handle so the thread still reads correctly. */
  readonly mentionOnReparent: boolean;
}

/** `credentialRef` points into the vault — tokens never reach this service's tables. */
export interface PlatformContext {
  readonly socialAccountId: string;
  readonly platformAccountId: string;
  readonly credentialRef: string;
}

export interface RawPlatformComment {
  readonly platformCommentId: string;
  readonly parentPlatformCommentId: string | null;
  readonly body: string;
  readonly author: {
    readonly platformUserId: string;
    readonly handle: string | null;
    readonly displayName: string | null;
    readonly avatarUrl: string | null;
  };
  readonly createdAt: Date;
  readonly likeCount: number | null;
  readonly replyCount: number | null;
  readonly isFromOwner: boolean;
  readonly permalink: string | null;
  /** Verbatim payload, so an unmapped field is recoverable by backfill, not a re-crawl. */
  readonly raw: Record<string, unknown>;
}

export interface FetchCommentsPage {
  readonly comments: readonly RawPlatformComment[];
  /** Platform cursor. Persisted internally, never exposed through our API. */
  readonly nextCursor: string | null;
}

export interface FetchCommentsParams {
  readonly platformPostId: string;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface PublishReplyParams {
  readonly platformPostId: string;
  readonly parentPlatformCommentId: string | null;
  readonly body: string;
  /** Stable across retries; forwarded to platforms that deduplicate requests. */
  readonly requestId: string;
}

export interface PublishReplyResult {
  readonly platformCommentId: string;
  readonly createdAt: Date;
  readonly permalink: string | null;
}

export interface PlatformCommentClient {
  readonly platform: PlatformId;
  readonly capabilities: PlatformCapabilities;

  fetchComments(ctx: PlatformContext, params: FetchCommentsParams): Promise<FetchCommentsPage>;

  publishReply(ctx: PlatformContext, params: PublishReplyParams): Promise<PublishReplyResult>;
}
