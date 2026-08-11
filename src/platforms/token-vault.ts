import { Injectable } from '@nestjs/common';
import { PlatformError } from './platform.errors';

// The seam to real OAuth storage: adapters depend on this, never on a store.
export abstract class TokenVault {
  abstract getAccessToken(credentialRef: string, platform: string): Promise<string>;
}

@Injectable()
export class InMemoryTokenVault extends TokenVault {
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
