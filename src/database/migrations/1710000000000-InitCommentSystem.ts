import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitCommentSystem1710000000000 implements MigrationInterface {
  name = 'InitCommentSystem1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Trimmed to what the comment system needs; fuller in the real product.
    await queryRunner.query(`
      CREATE TABLE social_accounts (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id        uuid NOT NULL,
        platform            text NOT NULL,   -- text, not enum: new platforms need no migration
        platform_account_id text NOT NULL,
        handle              text,
        credential_ref      text NOT NULL,   -- pointer into the vault, never a token
        created_at          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_social_accounts_identity UNIQUE (workspace_id, platform, platform_account_id)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE posts (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id      uuid NOT NULL,
        social_account_id uuid NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        platform          text NOT NULL,
        platform_post_id  text,
        published_at      timestamptz,
        permalink         text,
        created_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_posts_published_together CHECK (
          (platform_post_id IS NULL) = (published_at IS NULL)
        )
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_posts_platform_id ON posts (social_account_id, platform_post_id)
        WHERE platform_post_id IS NOT NULL;
    `);
    await queryRunner.query(
      `CREATE INDEX ix_posts_workspace_published ON posts (workspace_id, published_at DESC);`,
    );

    await queryRunner.query(`
      CREATE TABLE comment_authors (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        platform         text NOT NULL,
        platform_user_id text NOT NULL,
        handle           text,
        display_name     text,
        avatar_url       text,
        updated_at       timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_comment_authors_platform_user
        ON comment_authors (platform, platform_user_id);
    `);

    // Mirrored comments and the outbound reply queue, distinguished by `origin`.
    await queryRunner.query(`
      CREATE TABLE comments (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id        uuid NOT NULL,
        post_id             uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        social_account_id   uuid NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        platform            text NOT NULL,
        platform_comment_id text,            -- NULL until an outbound reply is delivered

        parent_id           uuid REFERENCES comments(id) ON DELETE CASCADE,
        root_id             uuid NOT NULL,
        depth               int  NOT NULL,
        path                text NOT NULL,

        author_id           uuid REFERENCES comment_authors(id) ON DELETE SET NULL,
        body                text NOT NULL,
        like_count          int  NOT NULL DEFAULT 0,
        reply_count         int  NOT NULL DEFAULT 0,
        is_from_owner       boolean NOT NULL DEFAULT false,
        permalink           text,
        raw                 jsonb NOT NULL DEFAULT '{}'::jsonb,

        platform_created_at timestamptz,
        synced_at           timestamptz,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now(),
        deleted_at          timestamptz,

        -- One sort key for every listing, computed by Postgres so it cannot drift.
        sort_at timestamptz NOT NULL
          GENERATED ALWAYS AS (COALESCE(platform_created_at, created_at)) STORED,

        origin              text NOT NULL DEFAULT 'platform',
        delivery_status     text,
        delivery_attempts   int  NOT NULL DEFAULT 0,
        next_attempt_at     timestamptz,
        last_error          jsonb,
        idempotency_key     text,
        request_fingerprint text,
        was_reparented      boolean NOT NULL DEFAULT false,

        CONSTRAINT ck_comments_origin CHECK (origin IN ('platform', 'blotato')),
        CONSTRAINT ck_comments_delivery_status CHECK (
          delivery_status IS NULL OR delivery_status IN ('pending','sending','sent','failed')
        ),
        CONSTRAINT ck_comments_depth CHECK (depth >= 0),
        -- Mirrored rows are by definition already on the platform.
        CONSTRAINT ck_comments_mirrored_has_platform_id CHECK (
          origin <> 'platform' OR platform_comment_id IS NOT NULL
        ),
        -- Anything we send carries delivery state; anything we mirrored does not.
        CONSTRAINT ck_comments_outbound_has_status CHECK (
          (origin = 'blotato') = (delivery_status IS NOT NULL)
        ),
        CONSTRAINT ck_comments_root_consistency CHECK (
          (depth = 0 AND parent_id IS NULL) OR (depth > 0 AND parent_id IS NOT NULL)
        )
      );
    `);

    // Identity: a replayed sync page cannot duplicate a comment.
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_comments_platform_id
        ON comments (social_account_id, platform_comment_id)
        WHERE platform_comment_id IS NOT NULL;
    `);

    // Idempotency enforced by the database, not by an app-level check that races.
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_comments_idempotency
        ON comments (workspace_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX ix_comments_post_thread ON comments (post_id, depth, sort_at, id)
        WHERE deleted_at IS NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX ix_comments_parent ON comments (parent_id, sort_at, id)
        WHERE deleted_at IS NULL;
    `);

    // Subtree fetch; text_pattern_ops keeps the prefix match usable under any collation.
    await queryRunner.query(
      `CREATE INDEX ix_comments_path ON comments (post_id, path text_pattern_ops);`,
    );

    // The dispatcher's claim query; partial, so it tracks the queue not all history.
    await queryRunner.query(`
      CREATE INDEX ix_comments_outbox_due ON comments (next_attempt_at, id)
        WHERE delivery_status IN ('pending', 'sending');
    `);

    await queryRunner.query(`
      CREATE TABLE comment_sync_state (
        post_id              uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
        workspace_id         uuid NOT NULL,
        platform             text NOT NULL,
        last_synced_at       timestamptz,
        next_poll_at         timestamptz,
        consecutive_failures int NOT NULL DEFAULT 0,
        last_error           jsonb,
        updated_at           timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX ix_sync_state_due ON comment_sync_state (next_poll_at) WHERE next_poll_at IS NOT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS comment_sync_state;`);
    await queryRunner.query(`DROP TABLE IF EXISTS comments;`);
    await queryRunner.query(`DROP TABLE IF EXISTS comment_authors;`);
    await queryRunner.query(`DROP TABLE IF EXISTS posts;`);
    await queryRunner.query(`DROP TABLE IF EXISTS social_accounts;`);
  }
}
