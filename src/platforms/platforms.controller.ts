import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformCapabilities } from './platform-client.interface';
import { PlatformRegistry } from './platform-registry.service';

@ApiTags('platforms')
@Controller('v1/platforms')
export class PlatformsController {
  constructor(private readonly registry: PlatformRegistry) {}

  /**
   * Capability discovery. Without it every client hardcodes its own copy of
   * "Instagram allows 2200 characters, replies nest one level" and drifts.
   * Serving the same objects the backend enforces means a new platform shows up
   * with correct counters and nesting behaviour with no client release.
   */
  @Get()
  @ApiOperation({ summary: 'List supported platforms and their comment capabilities' })
  list(): { platforms: { platform: string; capabilities: PlatformCapabilities }[] } {
    return { platforms: this.registry.list() };
  }
}
