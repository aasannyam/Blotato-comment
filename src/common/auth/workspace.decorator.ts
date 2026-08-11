import { ExecutionContext, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

export const WorkspaceId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const workspaceId = ctx.switchToHttp().getRequest<Request>().header('x-workspace-id');
  if (!workspaceId) throw new UnauthorizedException('Missing X-Workspace-Id header.');
  return workspaceId;
});
