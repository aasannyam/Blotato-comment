import { Inject, Injectable, Logger } from '@nestjs/common';
import { UnsupportedPlatformException } from '../common/errors/domain.exception';
import {
  PlatformCapabilities,
  PlatformCommentClient,
  PlatformId,
} from './platform-client.interface';

export const PLATFORM_CLIENTS = Symbol('PLATFORM_CLIENTS');

/** The only place that knows which platforms exist. */
@Injectable()
export class PlatformRegistry {
  private readonly clients = new Map<PlatformId, PlatformCommentClient>();

  constructor(@Inject(PLATFORM_CLIENTS) clients: PlatformCommentClient[]) {
    for (const client of clients) this.clients.set(client.platform, client);
    new Logger(PlatformRegistry.name).log(`Adapters: ${[...this.clients.keys()].join(', ')}`);
  }

  get(platform: PlatformId): PlatformCommentClient {
    const client = this.clients.get(platform);
    if (!client) throw new UnsupportedPlatformException(platform);
    return client;
  }

  capabilities(platform: PlatformId): PlatformCapabilities {
    return this.get(platform).capabilities;
  }

  list(): { platform: PlatformId; capabilities: PlatformCapabilities }[] {
    return [...this.clients.values()].map((c) => ({
      platform: c.platform,
      capabilities: c.capabilities,
    }));
  }
}
