import { Injectable } from '@nestjs/common';
import { PlatformError } from './platform.errors';

/**
 * Resolves a `credentialRef` into an access token.
 *
 * ASSUMPTION: Blotato already has OAuth storage and refresh — it must, to
 * publish at all. This is the seam to it, kept in-memory so the comment system
 * is reviewable on its own. Tokens are fetched per call and never persisted or
 * logged here.
 */
@Injectable()
export class TokenVaultService {
  private readonly tokens = new Map<string, string>();

  set(credentialRef: string, accessToken: string): void {
    this.tokens.set(credentialRef, accessToken);
  }

  async getAccessToken(credentialRef: string, platform: string): Promise<string> {
    const token = this.tokens.get(credentialRef);
    if (!token) {
      throw new PlatformError({
        code: 'AUTH_EXPIRED',
        platform,
        message: 'social account is not connected or its token was revoked',
      });
    }
    return token;
  }
}
