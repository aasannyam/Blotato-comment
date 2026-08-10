import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListCommentsQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;

  @ApiPropertyOptional({ description: 'Opaque cursor from a previous response.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ enum: ['oldest', 'newest'], default: 'oldest' })
  @IsOptional()
  @IsIn(['oldest', 'newest'])
  order: 'oldest' | 'newest' = 'oldest';

  @ApiPropertyOptional({
    default: false,
    description:
      'Pull from the platform first. Costs a platform request; if it fails, cached comments ' +
      'are still returned with meta.syncError set.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === true || value === 'true'))
  @IsBoolean()
  refresh?: boolean;
}
