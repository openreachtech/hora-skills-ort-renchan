# Migrations

One create-table migration per credential / token table, written with the standard migration shape (`MigrationAttributeFactory`, a `COLUMN_NAME` map, snake_case `field:`, `addIndex`). See the migration convention for the skeleton; this reference is only the auth-specific columns and indexes.

Tables, per actor (`<Actor>` shown):

- `<actor>_secrets` (+ `<actor>_secrets_bk` backup) — `<actor>_id`, `email`, `saved_at`.
- `<actor>_password_hashes` (+ `<actor>_password_hashes_bk` backup) — `<actor>_id`, `password_hash`, `saved_at`.
- `<actor>_access_tokens` — `<actor>_id`, `access_token`, `session_key`, `generated_at`, `expired_at`.
- `<actor>_refresh_tokens` — `<actor>_id`, `token_hash`, `session_key`, `used_at`, `revoked_at`, `generated_at`, `expired_at`.

Auth-specific points:

- **Unique index on the token digest** (`token_hash`) and on `access_token` — each is the lookup key, and the unique index makes a duplicate impossible.
- **Index `session_key`** on both token tables — rotation and revocation query by series.
- Foreign keys (`<actor>_id`) are plain `BIGINT` columns with an index and **no** DB-level `references` constraint — the renchan convention.
- The `_bk` backup table mirrors the source columns; it pairs with the backup mixin on the model it shadows ([token-models](./token-models.md)). **Both credential tables take one** — a secret and a digest are each replaced rather than edited, and the history is what a reset or an address change leaves behind. The token tables take none: a token is deleted or revoked, never rewritten.

The columns map one-to-one to the model attributes ([token-models](./token-models.md)) — camelCase attribute ↔ snake_case column via `underscored: true`. Add or change a column in the migration and the model together.
