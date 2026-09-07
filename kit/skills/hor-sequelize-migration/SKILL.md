---
name: hor-sequelize-migration
description: >
  Write and edit renchan/Sequelize migration files (sequelize/migrations/*.cjs). Use this skill
  whenever the user asks to create or update a migration — creating a table (createTable), adding
  or removing a column (addColumn / removeColumn), declaring an index or a unique constraint
  (addIndex), naming an index, or deciding whether to add a foreign-key column.
---

# Sequelize Migration

A skill for writing the `sequelize/migrations/*.cjs` files. It defines the **physical schema**
(tables, columns, indexes); the **logical declarations** layered on top (attributes / association
/ scope / hook) are written by `hor-sequelize-model`. Keep the two in one-to-one correspondence —
when you add a column in the migration, add the matching attribute in the model (and vice versa).
The conventions are split across the detail files below.

This repo does **not** `sync`. The schema is **built entirely by migrations** (dev = SQLite /
staging = MySQL / live = MariaDB — the dialects differ). A model's `unique: true` and the like are
only declarations; **the real object is always created by the migration**.

## Grand principle: a migration is a filled-in template

Every migration has the **same skeleton**: `'use strict'` → `require` the factory → `TABLE_NAME` /
`COLUMN_NAME` constants → `module.exports = { up, down }`, where `up` runs
`createTable(...factory.ID_BIGINT, <columns>, ...factory.TIMESTAMPS)` → `addIndex`, and `down`
closes with `dropTable`. This is the same idea as "a model is a filled-in template" in
`hor-sequelize-model`: keep the skeleton identical so review attention
goes straight to the **file-specific differences (columns / indexes)**. Do not write it cleverly;
lean toward the layout of the existing migrations.

- **Comments: English for structural conventions, the surrounding language for domain notes.** A
  convention comment such as `// ForeignKey must start with upper case.` is written in English (the
  existing migrations do this, and it matches the model skill). Domain-explanation comments tied to
  a ticket or a spec are often written in Japanese in this repo — match the surrounding files.

## 1. File skeleton and constants (TABLE_NAME / COLUMN_NAME)

One migration = one file placed directly under `sequelize/migrations/`. The filename is
`{timestamp}-{seq}-<operation>-<table>[-<column>].cjs`.

- `{timestamp}` is the creation time `YYYYMMDDHHmmss` (14 digits; `date +%Y%m%d%H%M%S`). Files are
  applied in ascending timestamp order — i.e. in creation-time order.
- `{seq}` is a **6-digit, zero-padded running number** (`000001`, `000002`, ...). It doubles as the
  ordering within the same timestamp and as a human-facing identifier.
- The operation is `create_table` (create a table) / `alter_table` (add / remove / change columns
  on an existing table).
- Examples: `20260717135803-000001-create_table-content_generations.cjs` /
  `20260717140512-000002-alter_table-content_generation_jobs-webhook_url.cjs`
- `.cjs` (CommonJS). Start with `'use strict'` and `require` the factory, then declare `TABLE_NAME`
  and `COLUMN_NAME` (the **single source of truth** for physical column names). `COLUMN_NAME` keys
  are `SCREAMING_SNAKE`, values are the physical names (snake_case). This value is referenced by
  both the column's `field:` and the index name.
- Older migrations predate this and use the `<8-digit-seq>-create_table-...` form (no timestamp).
  Write new files in the new form above.

```js
// Good example (the whole shape of a create-table migration)
'use strict'

const MigrationAttributeFactory = require('@openreachtech/renchan-sequelize/lib/tools/MigrationAttributeFactory.cjs')

const TABLE_NAME = 'content_generations'
const COLUMN_NAME = {
  CONTENT_GENERATION_JOB_ID: 'content_generation_job_id',
  RESULT_JSON: 'result_json',
  MODEL: 'model',
}

// Define an initialism only for a column whose index name would run long (§4).
const SHORT_COLUMN_NAME = {
  CONTENT_GENERATION_JOB_ID: 'cgji',
}

module.exports = {
  async up (
    queryInterface,
    Sequelize
  ) {
    const factory = MigrationAttributeFactory.create(Sequelize)

    await queryInterface.createTable(TABLE_NAME, {
      ...factory.ID_BIGINT,

      // ForeignKey must start with upper case.
      ContentGenerationJobId: {
        type: Sequelize.BIGINT,
        field: COLUMN_NAME.CONTENT_GENERATION_JOB_ID,
        allowNull: false,
      },
      resultJson: {
        type: Sequelize.JSON,
        field: COLUMN_NAME.RESULT_JSON,
        allowNull: true,
      },
      model: {
        type: Sequelize.STRING(64),
        field: COLUMN_NAME.MODEL,
        allowNull: false,
      },

      ...factory.TIMESTAMPS,
    })

    // A 1:1 relation is enforced by a UNIQUE index (no DB FK).
    await queryInterface.addIndex(TABLE_NAME, [
      COLUMN_NAME.CONTENT_GENERATION_JOB_ID,
    ], {
      unique: true,
      name: [
        TABLE_NAME,
        SHORT_COLUMN_NAME.CONTENT_GENERATION_JOB_ID,
        'unique',
      ].join('_'),
    })

    return Promise.resolve()
  },

  async down (
    queryInterface,
    Sequelize
  ) {
    return queryInterface.dropTable(TABLE_NAME)
  },
}
```

- `up (queryInterface, Sequelize)` / `down (queryInterface, Sequelize)` take those two arguments in
  that order. `up` runs `factory.create(Sequelize)` → `createTable` → `addIndex` →
  `return Promise.resolve()`; `down` is `return queryInterface.dropTable(TABLE_NAME)`.
- **Each column** is declared with a camelCase key + `field: COLUMN_NAME.X` (the snake physical
  name). **Always** declare `allowNull`, and add `defaultValue` when the column has a default. The
  type is `Sequelize.X` (`BIGINT` / `INTEGER` / `STRING(n)` / `TEXT` (long items: `TEXT('medium')`) /
  `DATE(3)` / `BOOLEAN` / `JSON` / `DECIMAL(p,s)` / `BLOB('long')`). Avoid `ENUM`; use a domain
  constant + `STRING(n)`.
  Datetimes default to `DATE(3)`. Keep `allowNull` / `defaultValue` in sync with the same-named
  column on the model side.

For the constants' rationale, the DataTypes table, and file naming, see
[notation.md](./references/notation.md).

## 2. created_at / updated_at come from the shared preset

Do not hand-write `created_at` / `updated_at`; spread `...factory.TIMESTAMPS` at the **end** of the
`createTable` object. The PK follows the same idea — spread `...factory.ID_BIGINT` (or
`...factory.ID_INTEGER` for an integer PK) at the **top**. Never hand-write `id`.

- `factory.TIMESTAMPS` = `created_at` / `updated_at` (both `DATE(3)`, `allowNull: false`).
- `factory.TIMESTAMPS_WITH_DELETED_AT` = the above + `deleted_at`. Use it on tables that
  **soft-delete**, paired with `paranoid: true` on the model side (see the default-methods of
  `hor-sequelize-model`).
- `factory.ID_BIGINT` = the four-piece set `bigint` / `autoIncrement` / `primaryKey` /
  `allowNull:false`.

```js
// Good example (PK at the top, timestamps at the end — both from the shared preset)
await queryInterface.createTable(TABLE_NAME, {
  ...factory.ID_BIGINT,

  // ... business columns ...

  ...factory.TIMESTAMPS_WITH_DELETED_AT, // also creates deleted_at (model side: paranoid:true)
})
```

- **Why**: `created_at` / `updated_at` / `deleted_at` are audit / framework-operational columns, and
  their values are supplied by the model's `timestamps: true`. Routing the column definitions
  through the shared preset keeps millisecond precision (`DATE(3)`), NOT NULL, and the column names
  aligned across every table. The model side does **not** put these in its attributes (see the
  timestamps of `hor-sequelize-model`); only the migration creates the
  columns.

## 3. FK-like columns (no DB foreign-key constraint)

Create the **FK-like column** (a column holding another table's id), but **do not add a DB
foreign-key constraint**.

Make the FK-like column's key **start with an uppercase letter** (`ContentGenerationJobId` /
`CustomerId`) and write `// ForeignKey must start with upper case.` in English immediately above it.
The type is `BIGINT`.

```js
// Good example (an FK-like column — column + comment only, no constraint)
// ForeignKey must start with upper case.
CustomerId: {
  type: Sequelize.BIGINT,
  field: COLUMN_NAME.CUSTOMER_ID,
  allowNull: false,
},
```

- **Why the uppercase start**: the model's association resolves the FK name by the convention
  "`<associated model name>` + `Id`" (see `hor-sequelize-model`). `field:`
  maps it to snake (`..._id`).

**Do not write foreign-key constraints.** No `references` on the column, no `onDelete` / `onUpdate`,
and no `addConstraint` to add an FK constraint (there is not a single FK constraint in the existing
migrations).

- **1:1** is enforced by a **UNIQUE index**, not an FK (§4).
  `// A 1:1 relation is enforced by a UNIQUE index (no DB FK).`
- **Circular FKs** and optional relations are **column-only and nullable** (`content_sessions` ⇄
  `content_generation_jobs`; `// ForeignKey must start with upper case. (circular FK, column
  only)`).
- A set of ids you do not want to make FKs is held as a `JSON` array (`optionIdsJson` /
  `// An array of ids without an FK.`).
- FK columns usually get a (plain) index for lookups (§4). The meaning of the relation is left to
  the model's association.

- **Why**: dev = SQLite / staging = MySQL / live = MariaDB differ, and there is no `sync`. A DB FK
  constraint pins insert order and makes cloning into backup (`*_bk`) tables and handling circular
  references awkward. Referential integrity is enforced in the **app layer** (associations,
  transactions, existence checks). See [foreign-keys.md](./references/foreign-keys.md); for the
  column notation see [notation.md](./references/notation.md).

## 4. Index naming

Add an index with `queryInterface.addIndex(TABLE_NAME, [columns...], { name, unique? })`. Build the
`name` by `.join('_')` on an array: **a plain index ends in `'index'`, a UNIQUE one adds
`unique: true` and ends in `'unique'`**.

```js
// Good example (a plain index and a UNIQUE one; wrap multiples in Promise.all)
await Promise.all([
  queryInterface.addIndex(TABLE_NAME, [
    COLUMN_NAME.ACCESS_TOKEN,
  ], {
    unique: true,
    name: [TABLE_NAME, COLUMN_NAME.ACCESS_TOKEN, 'unique'].join('_'),
  }),
  queryInterface.addIndex(TABLE_NAME, [
    COLUMN_NAME.STATUS,
    COLUMN_NAME.EXPIRES_AT,
  ], {
    name: [TABLE_NAME, COLUMN_NAME.STATUS, COLUMN_NAME.EXPIRES_AT, 'index'].join('_'),
  }),
])
```

- One index: `await` it directly. Multiple: wrap them in `Promise.all([...])`.
- For a composite index, list the columns (`..._status_expires_at_index`) or fold them into a
  meaningful label (`'plan_tier_currency_effective_at'` / `'job_package'`).
- A UNIQUE named index is the **actual constraint** behind a 1:1 relation or a natural key. A
  model's `unique: true` is only a declaration (see `hor-sequelize-model`).

### Shortening a long index name (over ~50 chars)

The DB identifier limit is 64 characters. As a safety margin, shorten once a name would run past
**~50 characters**. Shorten in the **following priority order**, taking the **initial of each
word**:

1. **First shorten the column name(s)** (`SHORT_COLUMN_NAME`), keeping the table name in full.
   e.g. `content_generations` + `cgji` (= content_generation_job_id) + `unique`
   → `content_generations_cgji_unique`
2. **Only if it is still too long, shorten the table name too** (`SHORT_TABLE_NAME`).
   e.g. `cgrf` (= content_generation_requirement_files) + `cgji` + `index`
   → `cgrf_cgji_index`

Initialism examples: `content_generation_job_id`→`cgji`, `chat_room_id`→`cri`,
`customer_id`→`ci`, `content_generation_requirement_files`→`cgrf`, `content_plan_rates`→`err`.
Put the abbreviations in `SHORT_COLUMN_NAME` / `SHORT_TABLE_NAME` constants and reference them from
the `addIndex` `name`. Details and a table of real abbreviations are in
[indexes.md](./references/indexes.md).

## 5. Adding / removing columns (alter_table)

Add a column to an existing table with `addColumn`, and drop the same column symmetrically in
`down`. The filename is `{timestamp}-{seq}-alter_table-<table>-<column>.cjs`.

- **Do not use `removeColumn` to drop a column.** Sequelize's `removeColumn` does not work on
  MariaDB (live), so run raw SQL `ALTER TABLE ... DROP COLUMN` via `queryInterface.sequelize.query`
  (in `up` or `down`; quote identifiers with backticks).
- `up` / `down` are **symmetric** (drop in `down` what `up` added). Column adds can be grouped with
  `Promise.all`, but drops are run as one raw statement per column, sequentially.
- Put a `/* ... */` block at the top of the file describing the **intent** (ticket number, spec
  reference, backward-compat notes).
- When adding a column to a table that already has rows, give it `allowNull: true` or a
  `defaultValue` (do not add a NOT NULL column after the fact).

```js
// Good example (intent comment + symmetric up/down; the drop uses raw SQL DROP COLUMN)
/*
 * Add webhook_url to content_generation_jobs (TICKET-1234).
 * When unset, the Worker falls back to integration_clients.default_webhook_url.
 */

const TABLE_NAME = 'content_generation_jobs'
const COLUMN_NAME = 'webhook_url'

module.exports = {
  async up (
    queryInterface,
    Sequelize
  ) {
    await queryInterface.addColumn(TABLE_NAME, COLUMN_NAME, {
      type: Sequelize.STRING(500),
      allowNull: true,
    })
  },

  async down (
    queryInterface,
    Sequelize
  ) {
    // removeColumn does not work on MariaDB, so drop via raw SQL DROP COLUMN.
    await queryInterface.sequelize.query(`
      ALTER TABLE \`${TABLE_NAME}\`
      DROP COLUMN \`${COLUMN_NAME}\`
    `)
  },
}
```

Details in [alter-table.md](./references/alter-table.md).

## Applying changes to the local DB

After adding or changing a migration, rebuild the local DB to apply it. Use the `package.json`
scripts:

- `npm run r` (= `npm run db:refresh`) — with `NODE_ENV=development`, runs teardown → migrate →
  seed:master → seed:dev in one shot. Use this after changing a migration / seeder.
- Individually: `npm run db:setup` (migrate only) / `npm run db:teardown` (delete the SQLite files).

## Detail files

- [notation.md](./references/notation.md) — file skeleton, `TABLE_NAME`/`COLUMN_NAME`, the PK /
  timestamps spread, a column's `field`/`allowNull`/`defaultValue`, DataTypes, uppercase-start FK
  columns (§1–§3)
- [foreign-keys.md](./references/foreign-keys.md) — why no DB FK, 1:1 via UNIQUE, circular FKs,
  JSON id arrays, indexing FK columns (§3)
- [indexes.md](./references/indexes.md) — index naming, UNIQUE, `Promise.all`, composite indexes,
  the shortening algorithm for long names with a table of real examples (§4)
- [alter-table.md](./references/alter-table.md) — `addColumn`, dropping a column with raw
  `DROP COLUMN` (because `removeColumn` fails on MariaDB), symmetric up/down, intent comment (§5)
