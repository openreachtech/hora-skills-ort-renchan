# Notation (file skeleton, seeds, bulkInsert / bulkDelete, timestamps)

The skeleton of a seeder file, how to write the `seeds` arrays, the `up` / `down` bodies, suites,
async fulfillment, and how timestamps are supplied. Referenced from §2 and §5 of `SKILL.md`. For
the directory split see [directory-structure.md](./directory-structure.md); for ids see
[id-numbering.md](./id-numbering.md).

## CommonJS, require the supplier (and any constants)

A seeder is a `.cjs` (CommonJS) file. Start with `'use strict'`, then **`require`
`TimestampSeedsSupplier`**. Optionally `require` domain constants so the seed and the app share one
source of truth for ids / names.

```js
'use strict'

const TimestampSeedsSupplier = require('@openreachtech/renchan-sequelize/lib/tools/TimestampSeedsSupplier.cjs')

const {
  AI_PROVIDER,
} = require('../../../app/constants/aiModel.cjs')
```

- **Why**: sequelize-cli loads seeders as CommonJS. `TimestampSeedsSupplier` injects the audit
  timestamps (see below). Pulling ids / names from `app/constants/*` keeps a canonical value in one
  place instead of hard-coding it in both the app and the seed.

## Intent comment, then `TABLE_NAME`

Put a `/* ... */` comment near the top saying what the seed is and its design-doc / plan reference
(domain prose is Japanese in this repo). Declare `TABLE_NAME` as a **string** for a single table, or
an **object** when one file fills several related tables (a "suite").

```js
// single table
const TABLE_NAME = 'ai_providers'
```

```js
// suite (several related tables in one file)
const TABLE_NAME = {
  CUSTOMERS: 'customers',
  CUSTOMER_BASICS: 'customer_basics',
  CUSTOMER_ACCESS_TOKENS: 'customer_access_tokens',
}
```

## `seeds` arrays use physical (snake_case) column names + explicit id

Each `seeds` array holds plain row objects. Keys are the **physical column names (snake_case)** —
the migration's `field:` names, **not** the model's camelCase — because `bulkInsert` writes raw
columns. Every row starts with an explicit `id` ([id-numbering.md](./id-numbering.md)). Do **not**
put `created_at` / `updated_at` in the rows (see "Timestamps" below).

```js
const seeds = [
  { id: AI_PROVIDER.DEFAULT.ID, name: AI_PROVIDER.DEFAULT.NAME },
]
```

```js
// FK columns are snake_case and hold an id from the referenced table's block
const seeds = [
  { id: 530001, software_package_id: 520001, name: 'Email integration', additional_cost: 500000, is_active: true },
  { id: 530002, software_package_id: 520001, name: 'Advanced reporting', additional_cost: 800000, is_active: true },
  { id: 530003, software_package_id: 520002, name: 'Multi-currency', additional_cost: 1000000, is_active: true },
]
```

- **Why snake_case**: the seed is coupled to the physical schema (the migration), not to the model.
  A camelCase key would write the wrong column.

## `up` = bulkInsert(supplyAll(seeds)); `down` = bulkDelete by id

`module.exports` has an `async up` and `async down`, each taking `(queryInterface, Sequelize)`.

```js
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert(TABLE_NAME, TimestampSeedsSupplier.supplyAll(seeds), {})
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete(TABLE_NAME, { id: seeds.map(it => it.id) })
  },
}
```

- `up` inserts `TimestampSeedsSupplier.supplyAll(seeds)` (the rows with audit timestamps added). The
  third `{}` is `bulkInsert`'s options.
- `down` deletes exactly the rows `up` inserted, by their explicit id list
  (`{ id: seeds.map(it => it.id) }`). This is why every row needs a stable, explicit `id`.

## Suites: insert parent → child, delete child → parent

When a file fills several related tables, insert **parent before child** in `up` (a child's FK
column must see its parent row) and delete **child before parent** in `down` (reverse order).

```js
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert(TABLE_NAME.CUSTOMERS, TimestampSeedsSupplier.supplyAll(customersSeeds), {})
    await queryInterface.bulkInsert(TABLE_NAME.CUSTOMER_BASICS, TimestampSeedsSupplier.supplyAll(customerBasicsSeeds), {})
    await queryInterface.bulkInsert(TABLE_NAME.CUSTOMER_ACCESS_TOKENS, TimestampSeedsSupplier.supplyAll(customerAccessTokensSeeds), {})
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete(TABLE_NAME.CUSTOMER_ACCESS_TOKENS, { id: customerAccessTokensSeeds.map(it => it.id) })
    await queryInterface.bulkDelete(TABLE_NAME.CUSTOMER_BASICS, { id: customerBasicsSeeds.map(it => it.id) })
    await queryInterface.bulkDelete(TABLE_NAME.CUSTOMERS, { id: customersSeeds.map(it => it.id) })
  },
}
```

- **Why**: there are no DB FK constraints (`hb-sequelize-migration`),
  but ordering still keeps the data coherent (no child row referencing a not-yet-inserted parent)
  and mirrors how the app writes these rows.

## Async fulfillment (computed values such as password hashes)

When a value must be computed (hashing a raw password, etc.), build the fulfilled array with
`await Promise.all(...)` inside `up` before `bulkInsert`. Keep the plain `seeds` array for `down`'s
id list.

```js
const encipher = Encipher.create()

async function fulfillPasswordHash ({ id, customer_id, raw_password, saved_at }) {
  const password_hash = await encipher.hash(raw_password)

  return { id, customer_id, saved_at, password_hash }
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const fulfilled = await Promise.all(
      customerPasswordHashesSeeds.map(it => fulfillPasswordHash(it))
    )

    await queryInterface.bulkInsert(TABLE_NAME.CUSTOMER_PASSWORD_HASHES, TimestampSeedsSupplier.supplyAll(fulfilled), {})
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete(TABLE_NAME.CUSTOMER_PASSWORD_HASHES, { id: customerPasswordHashesSeeds.map(it => it.id) })
  },
}
```

- **Why**: seeds are data-only; when a column's value is derived, compute it at seed time rather than
  storing a fake constant. The raw source (`raw_password`) stays in the plain array so `down` can
  still map ids.

## Timestamps come from TimestampSeedsSupplier

Do **not** write `created_at` / `updated_at` in seed rows. `TimestampSeedsSupplier.supplyAll(seeds)`
adds both to every row.

```js
// TimestampSeedsSupplier.supplyOne returns:
{ created_at: now, updated_at: now, ...seed }
```

- Because `...seed` is spread **after** the timestamps, a row **can override** them by including its
  own `created_at` / `updated_at` — but normally you don't. `deleted_at` is left unset (defaults to
  null).
- **Business datetimes are different.** A column that means something in the domain
  (`registered_at`, `saved_at`, `effective_at`, `generated_at`, `expired_at`) **is** written
  explicitly in the seed — it is not an audit column. This matches the model / migration split where
  audit timestamps come from the framework and business datetimes are their own columns
  (`hb-sequelize-migration`).
