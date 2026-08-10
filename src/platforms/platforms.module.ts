import { Module } from '@nestjs/common';
import { FakeCommentClient } from './clients/fake.client';
import { InstagramCommentClient } from './clients/instagram.client';
import { XCommentClient } from './clients/x.client';
import { PLATFORM_CLIENTS, PlatformRegistry } from './platform-registry.service';
import { PlatformsController } from './platforms.controller';
import { TokenVaultService } from './token-vault.service';

/** The extension point: a new platform is one client class plus one line here. */
@Module({
  controllers: [PlatformsController],
  providers: [
    TokenVaultService,
    XCommentClient,
    InstagramCommentClient,
    FakeCommentClient,
    {
      provide: PLATFORM_CLIENTS,
      inject: [XCommentClient, InstagramCommentClient, FakeCommentClient],
      useFactory: (...clients: unknown[]) => clients,
    },
    PlatformRegistry,
  ],
  exports: [PlatformRegistry, TokenVaultService, FakeCommentClient],
})
export class PlatformsModule {}
