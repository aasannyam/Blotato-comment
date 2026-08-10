import { ExecutionContext, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

/**
 * ASSUMPTION: Blotato already authenticates callers and can resolve a request to
 * a workspace. This reads a header so the endpoints are exercisable, and is the
 * one piece here that must be replaced with real auth middleware.
 *
 * What is not a stub: every service method takes `workspaceId` explicitly and
 * every query filters on it. Swapping this out changes where the id comes from,
 * never whether it is applied.
 */
export const WorkspaceId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const workspaceId = ctx.switchToHttp().getRequest<Request>().header('x-workspace-id');
  if (!workspaceId) throw new UnauthorizedException('Missing X-Workspace-Id header.');
  return workspaceId;
});
