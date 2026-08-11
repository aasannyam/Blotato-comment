import { Module, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FakeCommentClient } from './clients/fake.client';
import { InstagramCommentClient } from './clients/instagram.client';
import { XCommentClient } from './clients/x.client';
import { PlatformCommentClient } from './platform-client.interface';
import { PLATFORM_CLIENTS, PlatformRegistry } from './platform-registry.service';
import { PlatformsController } from './platforms.controller';
import { InMemoryTokenVault, TokenVault } from './token-vault.service';

// The extension point: a new platform is one class plus one entry here.
const CLIENTS: Type<PlatformCommentClient>[] = [
  XCommentClient,
  InstagramCommentClient,
  FakeCommentClient,
];

@Module({
  controllers: [PlatformsController],
  providers: [
    InMemoryTokenVault,
    { provide: TokenVault, useExisting: InMemoryTokenVault },
    ...CLIENTS,
    {
      provide: PLATFORM_CLIENTS,
      inject: [ConfigService, ...CLIENTS],
      // The fake adapter publishes into memory and reports success, so it is
      // registered only where that is wanted — otherwise GET /v1/platforms
      // advertises it and a post could "deliver" to nothing.
      useFactory: (config: ConfigService, ...clients: PlatformCommentClient[]) =>
        config.get<boolean>('platforms.fakeEnabled', false)
          ? clients
          : clients.filter((client) => client.platform !== 'fake'),
    },
    PlatformRegistry,
  ],
  exports: [PlatformRegistry, TokenVault, InMemoryTokenVault, FakeCommentClient],
})
export class PlatformsModule {}
