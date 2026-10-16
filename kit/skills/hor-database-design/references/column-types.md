# Column types (choosing a type, and where files go)

Choosing a column's type from the shape of the data it holds, and why file bytes never live in the
database. Referenced from [SKILL.md](../SKILL.md). The concrete DataTypes and how to write them
belong to `hor-sequelize-migration`.

## Pick the column type from the shape of the data

Type each column to what it actually holds. The Type column is Sequelize notation, written for
MariaDB (the reference live database); the PostgreSQL column is what the same declaration becomes
on PostgreSQL.

| Data | Type | PostgreSQL | Note |
| --- | --- | --- | --- |
| Genuinely dynamic / schemaless values | `JSON` | `JSONB` (`jsonb`) | only for values never queried or joined relationally |
| URL | `TEXT` | `TEXT` | not `STRING(n)`, because real URLs have no reliable length bound |
| Long content (article body, description) | `TEXT('medium')` (MEDIUMTEXT) | `TEXT` | size the column to the content |
| Short string (name, code) | `STRING(n)` | `STRING(n)` (`varchar(n)`) | pick `n` by use |
| Datetime | `DATE(3)` (UTC) | `DATE(3)` (`timestamptz`) | [datetimes.md](./datetimes.md) |
| Status / category | master-table key column | master-table key column | [master-tables.md](./master-tables.md) |

- **Why `JSON` only for truly dynamic data**: `JSON` is the right home for a value whose structure
  varies per row and is never the target of a relational query (a settings blob, a captured
  third-party payload). It is the **wrong** home for data that has a fixed shape and relationships —
  stuffing normalizable rows into a `JSON` column hides them from joins, indexes, and constraints
  and directly violates the
  [grand principle](../SKILL.md#grand-principle-the-database-holds-canonical-normalized-truth).
  Normalize relational facts into tables; reserve `JSON` for the genuinely schemaless.
- **On PostgreSQL, default a JSON column to `JSONB`.** PostgreSQL's `json` type has no equality
  operator, so `DISTINCT`, `GROUP BY`, `UNION` and `=` over a table that holds one fail with
  `could not identify an equality operator for type json`. `jsonb` has the operator and can carry a
  GIN index; it does not keep key order or whitespace, which a schemaless blob never needs. Only
  PostgreSQL declares `JSONB` in Sequelize, so MariaDB, MySQL and SQLite keep `JSON`. Files that
  run on PostgreSQL and on another dialect choose with
  `queryInterface.sequelize.getDialect() === 'postgres'`.
- **Why URL as `TEXT`**: URLs (signed storage links, tracking-laden redirects) routinely exceed any
  `STRING(n)` you would guess, and a too-short limit truncates silently and corrupts the reference.
  `TEXT` removes the guess.
- **Why long content as `TEXT('medium')`**: plain `TEXT` can be too small for real article bodies;
  choose the width from the expected content rather than discovering the ceiling in production.
  This is a MariaDB and MySQL concern: `TEXT` is capped near 64KB there. PostgreSQL has one `TEXT`
  type with no such cap (about 1GB), so Sequelize drops the `'medium'` option with a warning and
  you write plain `TEXT`.
- **Why `STRING(n)` is sized by use**: a `STRING(191)` default comes from MariaDB and MySQL, where
  191 is the longest utf8mb4 column that fits an older index-key limit of 767 bytes. PostgreSQL has
  no such limit, so there `n` only has to fit the data.

```
-- Good: type matches the data's shape
settings_json  JSON            -- per-row dynamic structure, never queried relationally
avatar_url     TEXT            -- unbounded in practice
body           TEXT('medium')  -- long article content
```

```
-- Avoid: normalizable relations hidden inside JSON, and a length-capped URL
tags_json      JSON            -- should be a tags table + join (queryable, constrained)
avatar_url     STRING(255)     -- silently truncates a long signed URL
```

## Default integer columns to INTEGER / BIGINT; use SMALLINT only with a specific reason

For an integer column, default to `INTEGER` (and `BIGINT` for ids and anything that accumulates over
the table's life). Do **not** reach for `SMALLINT` (or `TINYINT`) to "save space" unless there is a
**specific, permanent bound** on the value that guarantees it can never outgrow the narrow range.

- **Why**: the storage a narrower integer saves is negligible (a few bytes per row), but the
  overflow it invites is not. A column sized to today's guessed range silently caps out when the
  data grows past it (`SMALLINT` tops out at 32767 signed), and widening it afterwards is an
  `ALTER TABLE` on a live table. Ranges almost always grow beyond the original estimate — the same
  reasoning that discourages `ENUM` in [master-tables.md](./master-tables.md). Defaulting to
  `INTEGER` removes the guess; `BIGINT` is already the id convention (`hor-sequelize-migration`).
- **Exception**: use `SMALLINT` only when the domain is **inherently and permanently bounded** (a
  value that is by definition 0–100, a fixed small code set) *and* the narrower type usefully
  documents that bound. That is a reason, not a micro-optimization — the default remains `INTEGER`.

```
-- Good: default width; ids and counters never run out of range
quantity     INTEGER
CustomerId   BIGINT      -- id convention
```

```
-- Avoid: narrowed "to save space" — overflows once the count passes 32767
view_count   SMALLINT    -- silently caps; widening later is an ALTER on a live table
```

## Keep files out of the database; store a reference

Never store a file's bytes in the database. Put the file in **external object storage** (S3, GCS,
etc.) and keep only a **reference** in the DB — the storage key or URL, as `TEXT` (above).

- **Why**: file bytes are large and volatile and are not relational truth (the
  [grand principle](../SKILL.md#grand-principle-the-database-holds-canonical-normalized-truth)).
  Storing them in a column bloats the table, slows every backup / replication / dump, and pushes
  binary delivery through the app tier. A reference keeps the canonical tables small and lets the
  storage service (and a CDN) do what it is good at; the DB stays the index of *where* the file is,
  not the file.

```
-- Good: the DB records where the file lives, not the file
documents (id, OwnerId, storage_key TEXT, content_type, byte_size, uploaded_at)
```

```
-- Avoid: binary content in the row
documents (id, OwnerId, file_blob BLOB)   -- bloats backups, slows replication, wrong tier for delivery
```
