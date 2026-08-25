# Indexes (naming, and shortening long names)

How to write `addIndex`, how to build the name, and the shortening algorithm for when a name runs
long. Referenced from §4 of `SKILL.md`. The fact that a UNIQUE index is the real constraint also
relates to [foreign-keys.md](./foreign-keys.md).

## `addIndex(TABLE_NAME, [columns...], { name, unique? })`

Add indexes with `queryInterface.addIndex`. The second argument is an array of **physical column
names** (`COLUMN_NAME.X`). Always give `name` explicitly, built by `.join('_')` on an array.

- **Plain index**: end it with `'index'` → `<table>_<column>_index`
- **UNIQUE index**: add `unique: true` and end it with `'unique'` → `<table>_<column>_unique`

```js
// Good example (UNIQUE)
await queryInterface.addIndex(TABLE_NAME, [
  COLUMN_NAME.ACCESS_TOKEN,
], {
  unique: true,
  name: [
    TABLE_NAME,
    COLUMN_NAME.ACCESS_TOKEN,
    'unique',
  ].join('_'),
})
```

- **Why**: omitting `name` lets Sequelize auto-name it, which is inconsistent across dialects and
  renames. The trailing `index` / `unique` makes the kind readable from the name. Taking the column
  name from `COLUMN_NAME` guarantees it matches the column definition's `field:` spelling.

## Multiple indexes → `Promise.all`; a single one → `await` directly

When adding several indexes to the same table, wrap them in `Promise.all([...])`. For just one,
`await` it directly.

```js
// Good example (multiple)
await Promise.all([
  queryInterface.addIndex(TABLE_NAME, [
    COLUMN_NAME.CHAT_ROOM_ID,
  ], {
    name: [TABLE_NAME, SHORT_COLUMN_NAME.CHAT_ROOM_ID, 'index'].join('_'),
  }),
  queryInterface.addIndex(TABLE_NAME, [
    COLUMN_NAME.CUSTOMER_ID,
  ], {
    name: [TABLE_NAME, SHORT_COLUMN_NAME.CUSTOMER_ID, 'index'].join('_'),
  }),
])
```

## Composite indexes: list the columns, or fold them into a meaningful label

A composite (multi-column) index may list all the columns, or fold them into a single meaningful
word when that runs long.

```js
// List the columns
name: [TABLE_NAME, COLUMN_NAME.STATUS, COLUMN_NAME.EXPIRES_AT, 'index'].join('_')
//  → content_sessions_status_expires_at_index

// Fold into a meaningful label (a wide composite UNIQUE)
name: [SHORT_TABLE_NAME, 'plan_tier_currency_effective_at', 'unique'].join('_')
//  → cpr_plan_tier_currency_effective_at_unique
name: [SHORT_TABLE_NAME, 'job_package', 'unique'].join('_')
//  → cgjp_job_package_unique
```

## Shortening a long index name (over ~50 chars)

The DB identifier limit is 64 characters. As a **safety margin, shorten once a name would run past
~50 characters**. Shorten in stages, in the **following priority order**.

### Priority 1: shorten the column name(s) first (keep the table name in full)

Define `SHORT_COLUMN_NAME` and swap only the column part of the `name` for it. Keep the table name
in full.

```js
const SHORT_COLUMN_NAME = {
  CONTENT_GENERATION_JOB_ID: 'cgji',
}

// content_generations_content_generation_job_id_unique (52 chars) is too long
//  → shorten only the column name
name: [
  TABLE_NAME,                                        // content_generations (full)
  SHORT_COLUMN_NAME.CONTENT_GENERATION_JOB_ID,   // cgji
  'unique',
].join('_')
//  → content_generations_cgji_unique (31 chars)
```

### Priority 2: if still too long, shorten the table name too

Only when shortening the column name is not enough (the table name itself is long) do you also
define `SHORT_TABLE_NAME` and shorten the table name.

```js
const SHORT_TABLE_NAME = 'cgrf'                              // content_generation_requirement_files
const SHORT_COLUMN_NAME = {
  CONTENT_GENERATION_JOB_ID: 'cgji',
}

name: [
  SHORT_TABLE_NAME,                                 // cgrf
  SHORT_COLUMN_NAME.CONTENT_GENERATION_JOB_ID,  // cgji
  'index',
].join('_')
//  → cgrf_cgji_index (15 chars)
```

- **Why this order**: the table name is the first thing a reader of an index uses to tell "which
  table is this", so keep it in full as long as possible. Shorten the **less-informative column
  name first**; cut the table name only as a last resort.

### How to shorten = take the initial of each word (split on `_`)

Build the abbreviation by splitting the snake_case name on `_` and concatenating the **first
character** of each word.

| Original name | Abbreviation |
| --- | --- |
| `content_generation_job_id` | `cgji` |
| `content_generation_requirement_files` | `cgrf` |
| `content_generation_job_packages` | `cgjp` |
| `content_plan_rates` | `cpr` |
| `chat_room_id` | `cri` |
| `customer_id` | `ci` |

- Always put abbreviations in `SHORT_COLUMN_NAME` / `SHORT_TABLE_NAME` constants and reference them
  from the `addIndex` `name` (do not inline). If abbreviations collide within a table, add a second
  letter (etc.) to keep them unique while staying meaningful.

### Shorten only when needed

If it fits within ~50 characters, do not shorten. `.join('_')` the full `TABLE_NAME` / `COLUMN_NAME`
as in `customers_registered_at_index`. **Do not mechanically initialize just because you can** (it
hurts readability).

## A UNIQUE named index is "the real constraint"

The uniqueness of a 1:1 relation's FK or a natural key is **actually enforced by this UNIQUE named
index**. A model's `unique: true` (`hb-sequelize-model`) is only a
reader-facing declaration and does not create a DB constraint (this repo does not `sync`). For the
policy of not adding DB FK constraints and enforcing 1:1 with a UNIQUE index, see
[foreign-keys.md](./foreign-keys.md).
