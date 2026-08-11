import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformCapabilities } from './platform-client.interface';
import { PlatformRegistry } from './platform-registry.service';

@ApiTags('platforms')
@Controller('v1/platforms')
export class PlatformsController {
  constructor(private readonly registry: PlatformRegistry) {}

  @Get()
  @ApiOperation({ summary: 'List supported platforms and their comment capabilities' })
  list(): { platforms: { platform: string; capabilities: PlatformCapabilities }[] } {
    return { platforms: this.registry.list() };
  }
}
