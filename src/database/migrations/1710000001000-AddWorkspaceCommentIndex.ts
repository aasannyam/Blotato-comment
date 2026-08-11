import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A separate migration rather than an edit to the initial one: that migration
 * has already run wherever this was deployed or demoed, and editing an applied
 * migration leaves those databases silently missing the index.
 */
export class AddWorkspaceCommentIndex1710000001000 implements MigrationInterface {
  name = 'AddWorkspaceCommentIndex1710000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // GET /v1/comments filters on workspace_id and sorts by sort_at, which every
    // existing index covers only under a post_id or parent_id prefix — so the
    // cross-post query was a sequential scan plus a sort.
    //
    // No DESC in the definition: Postgres scans an index backwards just as
    // cheaply, so one index serves ?order=oldest and ?order=newest alike.
    // Partial, matching the query's `deleted_at IS NULL`.
    await queryRunner.query(`
      CREATE INDEX ix_comments_workspace_recent ON comments (workspace_id, sort_at, id)
        WHERE deleted_at IS NULL;
    `);

    // Inner side of the ?unansweredOnly=true anti-join ("has a reply of ours").
    // ix_comments_parent cannot serve it: that index is not restricted by
    // origin, so the planner fell back to scanning every comment to find ours.
    // Partial on origin, so it stays proportional to replies we published.
    await queryRunner.query(`
      CREATE INDEX ix_comments_owner_replies ON comments (parent_id)
        WHERE origin = 'blotato' AND deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ix_comments_owner_replies;`);
    await queryRunner.query(`DROP INDEX IF EXISTS ix_comments_workspace_recent;`);
  }
}
