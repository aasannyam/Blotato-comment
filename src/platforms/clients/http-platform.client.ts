import {
  FetchCommentsPage,
  FetchCommentsParams,
  PlatformCapabilities,
  PlatformCommentClient,
  PlatformContext,
  PlatformId,
  PublishReplyParams,
  PublishReplyResult,
} from '../platform-client.interface';
import { TokenVault } from '../token-vault.service';

// Mechanics shared by adapters that call a real platform: credential lookup and
// nothing else. Fetching and publishing stay in the adapters, because URL
// shapes, pagination and response formats are exactly what differs between
// platforms — hoisting them here would trade one class per platform for a base
// full of per-platform branches.
export abstract class HttpPlatformClient implements PlatformCommentClient {
  abstract readonly platform: PlatformId;
  abstract readonly capabilities: PlatformCapabilities;

  constructor(protected readonly vault: TokenVault) {}

  protected token(ctx: PlatformContext): Promise<string> {
    return this.vault.getAccessToken(ctx.credentialRef, this.platform);
  }

  abstract fetchComments(
    ctx: PlatformContext,
    params: FetchCommentsParams,
  ): Promise<FetchCommentsPage>;

  abstract publishReply(
    ctx: PlatformContext,
    params: PublishReplyParams,
  ): Promise<PublishReplyResult>;
}
