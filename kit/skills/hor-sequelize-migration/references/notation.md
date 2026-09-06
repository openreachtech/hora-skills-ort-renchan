# Notation (file skeleton, constants, column notation)

The skeleton of a migration file, the `TABLE_NAME` / `COLUMN_NAME` constants, and how to write a
column inside `createTable`. Referenced from §1–§3 of `SKILL.md`. For indexes see
[indexes.md](./indexes.md); for the "no DB FK" rule see [foreign-keys.md](./foreign-keys.md).

## One migration = one file, `.cjs` (CommonJS)

Place one migration per file directly under `sequelize/migrations/`. The extension is `.cjs`; start
with `'use strict'` and **`require`** `MigrationAttributeFactory` (unlike the model side's `.js` /
`import`, a migration is CommonJS).

```js
'use strict'

const MigrationAttributeFactory = require('@openreachtech/renchan-sequelize/lib/tools/MigrationAttributeFactory.cjs')
```

- **Why**: sequelize-cli loads migrations as CommonJS. Written as `import` / ESM they will not load.
  The factory `require` path is fixed at `lib/tools/MigrationAttributeFactory.cjs` inside the
  package.

## Filename `{timestamp}-{seq}-<operation>-<table>[-<column>].cjs`

The filename is itself the execution order (ascending timestamp = creation-time order) and an index
of the operation.

- `{timestamp}` = creation time `YYYYMMDDHHmmss` (14 digits; obtained from `date +%Y%m%d%H%M%S`).
- `{seq}` = a 6-digit, zero-padded running number (`000001`…). It doubles as the order within the
  same timestamp and as a stable number for humans to refer to.
- The operation is `create_table` (create a table) / `alter_table` (add / remove / change columns on
  an existing table).
- Examples: `20260717135803-000001-create_table-content_generations.cjs` /
  `20260717140512-000002-alter_table-content_generation_jobs-webhook_url.cjs`
- **Why**: the leading timestamp fixes the apply order uniquely in creation-time order, and even
  when several people add migrations around the same time they rarely collide. The 6-digit seq is a
  stable identifier for a human to track "which migration is this".

(Older migrations use the `<8-digit-seq>-create_table-...` form. Write new files in the form above.)

## Declare `TABLE_NAME` and `COLUMN_NAME` at the top (single source of truth for physical names)

Outside `up` / `down`, before `module.exports`, declare `TABLE_NAME` (a string) and `COLUMN_NAME`
(an object). `COLUMN_NAME` keys are `SCREAMING_SNAKE`, values are the **physical column names
(snake_case)**. This value is referenced by **both** the column's `field:` and the index name (see
[indexes.md](./indexes.md)).

```js
const TABLE_NAME = 'content_plan_rates'
const COLUMN_NAME = {
  PLAN: 'plan',
  TIER: 'tier',
  UNIT_RATE: 'unit_rate',
  EFFECTIVE_AT: 'effective_at',
  IS_ACTIVE: 'is_active',
}
```

- **Why**: concentrating the physical names in one place keeps the `field:` and the index name from
  drifting apart in spelling. When a physical name changes, editing this one place makes both the
  `field:` and the index name follow. Do not inline string literals into column definitions or
  indexes.

## `module.exports = { up, down }`, arguments `(queryInterface, Sequelize)`

Both `up` / `down` are `async` and take `(queryInterface, Sequelize)` in that order. Inside `up`,
build `const factory = MigrationAttributeFactory.create(Sequelize)`.

```js
module.exports = {
  async up (
    queryInterface,
    Sequelize
  ) {
    const factory = MigrationAttributeFactory.create(Sequelize)

    await queryInterface.createTable(TABLE_NAME, {
      ...factory.ID_BIGINT,
      // ... columns ...
      ...factory.TIMESTAMPS,
    })

    // ... addIndex ...

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

- The `down` of a create-table migration is always `return queryInterface.dropTable(TABLE_NAME)`
  (drop the whole table). The `down` of a column migration is in [alter-table.md](./alter-table.md).
- `up` closes with `return Promise.resolve()` (the existing convention).

## Spread the PK with `...factory.ID_BIGINT` at the top

Put `...factory.ID_BIGINT` at the **top** of the object passed to `createTable`. Use
`...factory.ID_INTEGER` only when you need an integer PK. Never hand-write `id`.

- `factory.ID_BIGINT` returns `{ id: { field:'id', type: BIGINT, allowNull:false,
  autoIncrement:true, primaryKey:true } }`. It is the shorthand that keeps you from getting that
  four-piece set wrong.
- It corresponds one-to-one with `...factory.ID_BIGINT` on the model side
  (`hor-sequelize-model`).

```js
// Bad example (hand-writing id)
await queryInterface.createTable(TABLE_NAME, {
  id: {
    type: Sequelize.BIGINT,
    autoIncrement: true,
    primaryKey: true,
  },
  // ...
})
```

## Spread the timestamps with `...factory.TIMESTAMPS` at the end

Put `...factory.TIMESTAMPS` at the **end** of the `createTable` object. Do not hand-write
`created_at` / `updated_at`. For a table that soft-deletes, use
`...factory.TIMESTAMPS_WITH_DELETED_AT` (which also creates `deleted_at`), paired with
`paranoid: true` on the model side. See §2 of `SKILL.md`.

| preset | columns created |
| --- | --- |
| `factory.ID_BIGINT` | `id` (bigint / autoIncrement / primaryKey / NOT NULL) |
| `factory.ID_INTEGER` | `id` (integer version) |
| `factory.TIMESTAMPS` | `created_at` / `updated_at` (`DATE(3)` / NOT NULL) |
| `factory.TIMESTAMPS_WITH_DELETED_AT` | the above + `deleted_at` (`DATE(3)`) |

## Write columns with a camelCase key + `field:` (snake physical name)

Declare each column with a camelCase key and give `field:` the value `COLUMN_NAME.X`. The type is
`Sequelize.X`. **Always** write `allowNull`, and write `defaultValue` when there is a default.

```js
// Good example
role: {
  type: Sequelize.STRING(32),
  field: COLUMN_NAME.ROLE,
  allowNull: false,
},
currency: {
  type: Sequelize.STRING(8),
  field: COLUMN_NAME.CURRENCY,
  allowNull: false,
  defaultValue: 'JPY',
},
```

```js
// Bad example (field omitted → physical name becomes camelCase; allowNull omitted → defaults to true)
role: {
  type: Sequelize.STRING(32),
},
```

- **Why**: without `field:`, the physical name becomes camelCase and no longer matches the model
  (which maps to snake via `underscored:true`). Omitting `allowNull` falls back to Sequelize's
  default `true`, losing the NOT NULL intent. Keep `allowNull` / `defaultValue` aligned with the
  same-named column on the model side.

### DataTypes guide

| Type | Use |
| --- | --- |
| `BIGINT` | PK / FK-like id |
| `INTEGER` | small integer PK, quantity, version |
| `STRING(n)` | variable-length string (identifier `32`, display name / email `191`, etc. — pick by use) |
| `TEXT` / `TEXT('medium')` | long text (body, message, error). For an item that can grow long, use `TEXT('medium')` |
| `DATE(3)` | millisecond-precision datetime (`registeredAt` / `expiresAt`, etc.) |
| `BOOLEAN` | truth value (`isActive`, etc.) |
| `JSON` | structured data (`resultJson`; an FK-less id array `optionIdsJson`) |
| `DECIMAL(p, s)` | money / rate (`dailyRate` as `DECIMAL(14, 2)`, etc.) |
| `BLOB('long')` | binary (uploaded file body) |
| `ENUM(...)` | **avoid by default**; use a domain constant + `STRING(n)` |

- Datetimes default to `DATE(3)` (millisecond precision by default, for ordering comparisons and
  history uniqueness).
- Do not default string lengths to "255 for now". Choose by use, and keep the length identical on
  the model and migration sides.
- Plain `TEXT` is capped around 64KB; for a column that may hold long content, use
  `TEXT('medium')` (MEDIUMTEXT, ~16MB). Reach for `TEXT('long')` (LONGTEXT) only when even that is
  not enough.

## FK-like columns start with an uppercase letter + a comment (type BIGINT)

A column holding another table's id gets an **uppercase-starting** key
(`ContentGenerationJobId` / `CustomerId`) with `// ForeignKey must start with upper case.` in
English immediately above it. The type is `BIGINT`.

```js
// Good example
// ForeignKey must start with upper case.
ContentGenerationJobId: {
  type: Sequelize.BIGINT,
  field: COLUMN_NAME.CONTENT_GENERATION_JOB_ID,
  allowNull: false,
},
```

- **Why**: the model's association resolves the FK name by "`<associated model name>` + `Id`", so
  align on an uppercase start (`hor-sequelize-model`). `field:` maps it
  to snake (`..._id`).
- But **do not add a DB FK constraint**. Keep just the column and the comment, and express the
  relation on the model side ([foreign-keys.md](./foreign-keys.md)). Optional relations / circular
  FKs use `allowNull: true`, with a note such as
  `// ForeignKey must start with upper case. (circular FK, column only)` when helpful.
