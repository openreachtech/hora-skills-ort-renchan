# Column types (choosing a type, and where files go)

Choosing a column's type from the shape of the data it holds, and why file bytes never live in the
database. Referenced from [SKILL.md](../SKILL.md). The concrete DataTypes and how to write them
belong to `hb-sequelize-migration`.

## Pick the column type from the shape of the data

Type each column to what it actually holds:

| Data | Type | Note |
| --- | --- | --- |
| Genuinely dynamic / schemaless values | `JSON` | only for values never queried or joined relationally |
| URL | `TEXT` | not `STRING(n)` — real URLs have no reliable length bound |
| Long content (article body, description) | `TEXT('medium')` (MEDIUMTEXT) | size the column to the content |
| Datetime | `DATE(3)` (UTC) | [datetimes.md](./datetimes.md) |
| Status / category | master-table key column | [master-tables.md](./master-tables.md) |

- **Why `JSON` only for truly dynamic data**: `JSON` is the right home for a value whose structure
  varies per row and is never the target of a relational query (a settings blob, a captured
  third-party payload). It is the **wrong** home for data that has a fixed shape and relationships —
  stuffing normalizable rows into a `JSON` column hides them from joins, indexes, and constraints
  and directly violates the
  [grand principle](../SKILL.md#grand-principle-the-database-holds-canonical-normalized-truth).
  Normalize relational facts into tables; reserve `JSON` for the genuinely schemaless.
- **Why URL as `TEXT`**: URLs (signed storage links, tracking-laden redirects) routinely exceed any
  `STRING(n)` you would guess, and a too-short limit truncates silently and corrupts the reference.
  `TEXT` removes the guess.
- **Why long content as `TEXT('medium')`**: plain `TEXT` can be too small for real article bodies;
  choose the width from the expected content rather than discovering the ceiling in production.

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
  `INTEGER` removes the guess; `BIGINT` is already the id convention (`hb-sequelize-migration`).
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
