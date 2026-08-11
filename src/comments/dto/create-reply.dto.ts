import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateReplyDto {
  @ApiProperty({
    description:
      'Reply text. The per-platform limit is enforced separately and returns 422 with the ' +
      'applicable maximum — it varies by platform and shifts when a mention is prepended.',
    example: 'Thanks for reading — the follow-up drops on Friday.',
  })
  @IsString()
  @MinLength(1)
  // Transport ceiling only; the real per-platform limit is checked later.
  @MaxLength(10_000)
  body!: string;
}
