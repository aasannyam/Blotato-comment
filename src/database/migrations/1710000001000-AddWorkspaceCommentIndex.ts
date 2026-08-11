import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkspaceCommentIndex1710000001000 implements MigrationInterface {
  name = 'AddWorkspaceCommentIndex1710000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Cross-post reads: every other index is prefixed by post_id or parent_id.
    await queryRunner.query(`
      CREATE INDEX ix_comments_workspace_recent ON comments (workspace_id, sort_at, id)
        WHERE deleted_at IS NULL;
    `);

    // Inner side of the ?unansweredOnly=true anti-join ("has a reply of ours").
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
