import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { FakeCommentClient } from '../src/platforms/clients/fake.client';
import { TokenVaultService } from '../src/platforms/token-vault.service';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  configureApp(app);

  const workspaceId = randomUUID();
  const accountId = randomUUID();
  const postId = randomUUID();
  const platformPostId = 'demo-post-1';

  const db = app.get(DataSource);
  await db.query(
    `INSERT INTO social_accounts (id, workspace_id, platform, platform_account_id, handle, credential_ref)
     VALUES ($1, $2, 'fake', 'owner', 'blotato', 'demo-credential')`,
    [accountId, workspaceId],
  );
  await db.query(
    `INSERT INTO posts (id, workspace_id, social_account_id, platform, platform_post_id, published_at)
     VALUES ($1, $2, $3, 'fake', $4, now())`,
    [postId, workspaceId, accountId, platformPostId],
  );

  app.get(TokenVaultService).set('demo-credential', 'demo-token');

  const fake = app.get(FakeCommentClient);
  const first = fake.seed(platformPostId, {
    body: 'Great thread — do you have a longer writeup?',
    createdAt: new Date(Date.now() - 60_000),
    author: { platformUserId: 'u-1', handle: 'nina', displayName: 'Nina', avatarUrl: null },
  });
  fake.seed(platformPostId, {
    body: 'Seconded, would read that.',
    parentPlatformCommentId: first.platformCommentId,
    createdAt: new Date(Date.now() - 30_000),
    author: { platformUserId: 'u-2', handle: 'omar', displayName: 'Omar', avatarUrl: null },
  });
  fake.seed(platformPostId, {
    body: 'Saved this for later.',
    createdAt: new Date(Date.now() - 10_000),
    author: { platformUserId: 'u-3', handle: 'kai', displayName: 'Kai', avatarUrl: null },
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  const base = `http://localhost:${port}`;
  const auth = `-H 'X-Workspace-Id: ${workspaceId}'`;
  console.log(`
Demo ready on ${base}  (Swagger: ${base}/docs)

  # 1. Pull from the platform and list top-level comments
  curl -s ${auth} '${base}/v1/posts/${postId}/comments?refresh=true' | jq

  # 2. Replies under the first comment (take an id from step 1)
  curl -s ${auth} '${base}/v1/comments/<COMMENT_ID>/replies' | jq

  # 3. Reply — returns 202 with delivery.status "pending"; the dispatcher sends it within ~1s
  curl -s -X POST ${auth} -H 'Content-Type: application/json' \\
    -H 'Idempotency-Key: demo-1' \\
    -d '{"body":"Writeup goes out Friday!"}' \\
    '${base}/v1/comments/<COMMENT_ID>/replies' | jq

  # 4. Same request again -> 200, same comment, nothing re-sent
  # 5. Poll the reply until delivery.status is "sent"
  curl -s ${auth} '${base}/v1/comments/<REPLY_ID>' | jq

  # Replying to a depth-1 comment shows re-parenting: the fake platform allows
  # one level, so the reply attaches to the root with wasReparented: true and an
  # "@handle" prefix.

  curl -s '${base}/v1/platforms' | jq
`);
}

void main();
