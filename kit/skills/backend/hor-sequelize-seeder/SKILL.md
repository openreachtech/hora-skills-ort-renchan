---
name: hor-sequelize-seeder
description: >
  Write and edit renchan/Sequelize seeder files (sequelize/seeders/**/*.cjs). Use this
  skill whenever the user asks to create or update a seeder — inserting master or
  development data with bulkInsert / bulkDelete, choosing which directory
  (master / dev-master / development), naming a seeder file, allocating seed-row ids,
  or wiring TimestampSeedsSupplier. Covers the three-directory split and the db:seed:*
  scripts, the file skeleton, filename / numbering, and the per-file id-block
  numbering rule.
---

# Sequelize Seeders

A skill for writing the `sequelize/seeders/**/*.cjs` files. Where
`hor-sequelize-migration` builds the **physical schema** (tables,
columns, indexes), a seeder **fills those tables with rows** via `bulkInsert`. A seed row is a plain
object keyed by the **physical (snake_case) column names** — the same names the migration declares
as `field:` — so a seeder is coupled to the migration, not to the model's camelCase attributes.

> A concise overview. Each numbered section links to a detail file under `references/` for depth.

## Core principle: a seeder is a filled-in template

Every seeder has the **same skeleton**: `'use strict'` → `require` `TimestampSeedsSupplier` (+ any
domain constants) → an intent comment → `TABLE_NAME` → one or more `seeds` arrays → `module.exports
= { up, down }`, where `up` is `bulkInsert(TABLE_NAME, TimestampSeedsSupplier.supplyAll(seeds), {})`
and `down` is `bulkDelete(TABLE_NAME, { id: seeds.map(it => it.id) })`. Keep the skeleton identical
across files (the same idea as in `hor-sequelize-migration` and
`hor-sequelize-model`) so review attention goes to the **data**, not the
plumbing.

- **Deterministic, explicit ids.** Every seed row carries an explicit `id` (never rely on
  auto-increment), so `down` can `bulkDelete` exactly the rows `up` inserted, and so foreign-key
  columns in other seeds can point at a known id. The id scheme is the heart of this skill (§4).
- **Rows use physical (snake_case) column names** (`customer_id`, `unit_rate`, `is_active`) — the
  migration's `field:` names, not the model's camelCase. `bulkInsert` writes raw columns.
- **Comments**: structural comments in English (matching the model / migration skills); the
  domain-explanation comments in the real seeders of this repo are often Japanese (they cite the
  design doc / implementation plan) — match the surrounding files.

```js
// Good example (a whole single-table master seeder)
'use strict'

const TimestampSeedsSupplier = require('@openreachtech/renchan-sequelize/lib/tools/TimestampSeedsSupplier.cjs')

/*
 * Development sample: content plan rates (dev-master).
 * In production these are created via the admin CRUD. 3 plans × 3 tiers (JPY, per month).
 */

const TABLE_NAME = 'content_plan_rates'

const EFFECTIVE_AT = new Date('2024-01-01T00:00:00.000Z')

const seeds = [
  { id: 500001, plan: 'basic', tier: 'small', unit_rate: 50000, currency: 'JPY', effective_at: EFFECTIVE_AT, is_active: true },
  { id: 500002, plan: 'basic', tier: 'medium', unit_rate: 70000, currency: 'JPY', effective_at: EFFECTIVE_AT, is_active: true },
  { id: 500003, plan: 'basic', tier: 'large', unit_rate: 100000, currency: 'JPY', effective_at: EFFECTIVE_AT, is_active: true },
  // ...
]

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert(TABLE_NAME, TimestampSeedsSupplier.supplyAll(seeds), {})
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete(TABLE_NAME, { id: seeds.map(it => it.id) })
  },
}
```

## 1. Directory structure (release-split master / dev-master / development)

Seeders live under `sequelize/seeders/` in three kinds of directory, each seeded by its own
`db:seed:*` script (`--seeders-path` picks the directory). What separates them is **environment**
(production vs dev / CI) and **kind of data** (canonical master vs operational fixtures).

| Directory | Script | Environment | Purpose |
| --- | --- | --- | --- |
| `master-000001/`, `master-000002/`, … | `db:seed:prod` | production | **Production canonical master** data, split **one directory per release** (6-digit sequence). Applied in ascending release order. Ids are stable / meaningful, often from `app/constants/*` or small sequential. |
| `dev-master/` | `db:seed:dev-master` | dev / CI (local + CI tests) | The **master** data used in the dev / CI environment. Re-exports the production master files (DRY), plus a few dev-only master samples that production creates via admin CRUD. |
| `development/` | `db:seed:dev` | dev / CI (local + CI tests) | **Operational fixture** data for unit tests — rows that in production are created at runtime through operations (user lists, payment lists, …), **not** master data. Organized as `*-suite` bundles. Large blocked ids (§4). |

- **Release-split master.** Each release gets its own `master-<6-digit>/` directory holding the
  master data introduced or changed in that release; `db:seed:prod` applies the `master-*`
  directories in ascending order, so later releases build on earlier ones and each release's master
  additions are isolated and traceable. (The repo currently has a single pre-split `master/`; the
  release split is the convention from here on.)
- **dev-master vs development.** `dev-master` is the *same kind of canonical / config data as
  production master*, just loaded for dev / CI. `development` is *operationally-created data* (users,
  payments, …) that production never seeds — it exists only to give unit tests (local + CI)
  something to read. Both run only in dev / CI, never in production.
- `.directorykeeper.cjs` — a noop seeder (`up`/`down` do nothing) that keeps an otherwise-empty
  directory tracked and safe for the runner. Do not delete it.
- **`db:refresh` (alias `npm run r`)** rebuilds the local DB: `NODE_ENV=development` → teardown →
  migrate → **seed:dev-master** → **seed:dev**. It does **not** run `seed:prod` — the `master-*`
  set is for production.
- **Re-export for DRY**: a `dev-master/` file that must be identical to production is just
  `module.exports = require('../master-<release>/<same-name>.cjs')`, with a comment naming the
  production master as the source of truth. Do not copy-paste the data.

Details — the `.directorykeeper` no-op, the `db:seed:*` scripts table, and the full re-export
example — are in [directory-structure.md](./references/directory-structure.md).

## 2. File notation (skeleton)

- **Require `TimestampSeedsSupplier`** from `@openreachtech/renchan-sequelize/lib/tools/...` (a
  `.cjs`; seeders are CommonJS). Optionally `require` domain constants (`app/constants/*.cjs`) for
  ids / names, so the seed and the app share one source of truth.
- **Intent comment** (`/* ... */`) near the top: what this seed is, and its design-doc / plan
  reference. Domain prose is Japanese in this repo.
- **`TABLE_NAME`** is a string for a single table, or an **object** (`{ CUSTOMERS: 'customers', ...
  }`) when one seeder fills several related tables (a "suite").
- **`seeds` arrays** hold plain row objects: explicit `id` first, then snake_case columns. Do **not**
  put `created_at` / `updated_at` in the rows (§5).
- **`up`** runs `bulkInsert(TABLE, TimestampSeedsSupplier.supplyAll(seeds), {})`; **`down`** runs
  `bulkDelete(TABLE, { id: seeds.map(it => it.id) })`.
- **Suites insert parent → child and delete child → parent** (reverse order), so a child's FK column
  always sees its parent row, and deletes don't orphan. (There are no DB FK constraints —
  `hor-sequelize-migration` — but ordering still keeps the data
  coherent and mirrors real usage.)
- **Async fulfillment**: when a value must be computed (e.g. hashing a password via `Encipher`),
  build the fulfilled array with `await Promise.all(seeds.map(fulfillX))` inside `up` before
  `bulkInsert`; keep the plain `seeds` array for `down`'s id list.

The full skeleton, the suite example (parent → child insert / child → parent delete), and the
async-fulfillment example (e.g. password hashing) are in [notation.md](./references/notation.md).

## 3. Naming

A new seeder filename is `{timestamp}-{6-digit-seq}-{table_name}.cjs`, matching the migration
convention (e.g. `20260717135803-000001-customers.cjs`,
`20260717141020-000002-customers_suite.cjs`).

- **`{timestamp}`** is the creation time `YYYYMMDDHHmmss` (14 digits; `date +%Y%m%d%H%M%S`); files
  run in **ascending timestamp = creation order** (same as migrations). **`{6-digit-seq}`** is a
  zero-padded running number (`000001`, …). **`{table_name}`** is the physical table name in
  snake_case (a suite uses `<domain>_suite`).
- **Order parents before children**: within a suite the file inserts parent → child; across files,
  create the parent's seeder first so its timestamp is earlier and it runs first.
- **Older seeders** use the previous `<8-digit-seq>-<kebab-entity>.cjs` form; leave them, and write
  new files in the timestamp form (the
  `hor-sequelize-migration`
  skill made the same transition).
- A `dev-master/` re-export **keeps the same filename** as the `master-*/` file it re-exports.

Details in [naming.md](./references/naming.md).

## 4. Id numbering (a 10,000-wide id block per seeder / per table)

**Every seed row has an explicit `id`, and each table's rows are given a distinct id block whose
step is 10,000.** Bases are 6-digit multiples of 10,000 **starting at `100000`** (`100000`,
`110000`, `120000`, …); rows increment by 1 within the block, so one block holds up to ~10,000 rows.
The same base may be reused across different suites — safe, because the rows land in different
tables.

**Development suites (`development/`)** give each table *within the suite* its own 10,000-step base
(reused across suites):

| Table position in the suite | id base | example |
| --- | --- | --- |
| 1st (root, e.g. `customers` / `admins`) | `100000` | `100001`, `100002`, … |
| 2nd (`*_basics`) | `110000` | `110001`, … |
| 3rd (`*_secrets`) | `120000` | `120001`, … |
| 4th (`*_password_hashes`) | `130000` | `130001`, … |
| 5th (`*_access_tokens`) | `140000` | `140101`, `140201`, … |

**dev-master master samples** get one 6-digit, 10,000-wide block per file (`100000`, `110000`, …); a
child table's block sits above its parent's so its FK ids stay readable.

**Production master (`master-*/`)** is exempt from blocks: ids are small sequential (`1`…`7`) or
taken from `app/constants` (`AI_PROVIDER.DEFAULT.ID`), because canonical data ids are stable and
meaningful.

Rules that hold across all of these:

- **Bases are 6 digits (`≥ 100000`).** A `≥ 100000` id exceeds `SMALLINT`'s max (32,767 signed /
  65,535 unsigned), so a column wrongly declared `SMALLINT` in the migration **overflows and fails
  at seed time** — the schema mistake is caught while seeding, not in production. Never use a
  sub-100,000 base.
- **The step is 10,000.** Allocate the next free 6-digit multiple of 10,000 as a new seeder/table's
  base; never overlap two blocks that could collide within a single table.
- **A foreign-key column in a seed holds an id from the referenced table's block**
  (`software_package_id` → the packages block, `customer_id: 100001`). This is why bases must be
  predictable.
- **Rows increment by 1 within a block**; for hierarchical data, use a **structured id** that still
  fits inside the 10,000 block (access tokens use `14` + 2-digit customer + 2-digit sequence →
  `140101`, `140201`, `140202`, all inside the `140000` block).
- **Why**: ids stay deterministic and non-colliding within a table, so `down` deletes exactly what
  `up` inserted, cross-seed FKs resolve, and a row's origin is readable from its id. (Blocks are
  per-table, so reusing `100000` in both `customers` and `admins` is safe.)

Details — the FK-reference and structured-id examples, and the legacy sub-6-digit `dev-master`
blocks — are in [id-numbering.md](./references/id-numbering.md).

## 5. Timestamps come from TimestampSeedsSupplier

Do **not** put `created_at` / `updated_at` in seed rows. `TimestampSeedsSupplier.supplyAll(seeds)`
injects both (set to "now") for every row; `deleted_at` defaults to null.

- `supplyOne` returns `{ created_at: now, updated_at: now, ...seed }`, so a row **can override** the
  timestamps by including its own — but normally you don't.
- **Business datetimes are different** — a column that means something in the domain
  (`registered_at`, `saved_at`, `effective_at`, `generated_at`, `expired_at`) **is** written
  explicitly in the seed (it is not an audit column). This matches the model/migration split where
  audit timestamps come from the framework and business datetimes are their own columns.

Details in [notation.md](./references/notation.md).

## 6. Development fixtures cover the app's operational cases

A `development/` seeder is not just "some rows to read" — it must **comprehensively cover the cases
that arise in the app's operation**, because a unit test can only exercise a branch if a matching
fixture row exists. Cover, at minimum:

- **Success cases** — normal, valid operations that go through.
- **Failure cases** — operations rejected by a business rule (validation, insufficient balance,
  expired, over-limit, …).
- **Error cases** — abnormal / inconsistent states the code must still handle.
- **Status variety within the success cases** — one row per **distinct status** an entity defines
  (`pending` / `active` / `suspended` / `withdrawn`, …), so every status branch has a fixture.

- **Why**: happy-path-only fixtures leave the failure / error / status branches with nothing to
  read, so each test fabricates ad-hoc rows that drift from real data. Label each row's case with a
  comment and keep it in the suite / id-block scheme (§1, §4) so the block reads as a case list.
- This applies to `development/` (operational fixtures) only — **not** to master / dev-master, which
  hold canonical config data, not operational case variety.

Details — the case taxonomy, per-row labeling, and scoping coverage to what the app branches on —
are in [development-coverage.md](./references/development-coverage.md).

## 7. Keep every value distinct within a seeder (so a test mix-up is caught)

Choose seed values so that **the same value never appears in two different columns**. When a unit
test fails, distinct values make it obvious which column / seeder is involved, and they stop a
column mix-up from passing silently.

- **id vs FK / related columns**: never let a row's `id` and one of its other columns share a value.
  The 6-digit 10,000-wide id blocks (§4) already put each table's ids in a different range, so a
  row's `id` and its FK columns (which hold the *parent* table's block ids) never collide — keep it
  that way. If `id` is `100001`, a `user_id` on the same row must sit in a different block (e.g. from
  `110001`), never `100001`.
- **text columns**: columns like `username` and `name` must always hold **different** strings — do
  not reuse one value for both.
- **Why**: if `id` and `user_id` are both `100001`, a test that accidentally reads `user_id` where it
  meant `id` still finds a matching row and **passes** — a false positive. Distinct values make that
  mistake fail loudly and point straight at the offending seeder (the same reasoning as keeping
  test-case values unique).

Details in [id-numbering.md](./references/id-numbering.md).

## Applying to the local DB

After adding or changing a seeder, rebuild the local DB with **`npm run r`** (`db:refresh`:
teardown → migrate → seed:dev-master → seed:dev). To seed a single set without a full teardown, run
the matching script directly (`npm run db:seed:dev-master`, `db:seed:dev`, or `db:seed:prod`).

## Detail files

- [directory-structure.md](./references/directory-structure.md) — release-split master / dev-master
  / development, `.directorykeeper`, the `db:seed:*` scripts and `db:refresh` flow, the re-export
  DRY pattern (§1)
- [notation.md](./references/notation.md) — file skeleton, `TimestampSeedsSupplier`, `TABLE_NAME`
  string vs object, `seeds` arrays, `bulkInsert` / `bulkDelete`, suites and insert/delete order,
  async fulfillment, timestamps (§2, §5)
- [naming.md](./references/naming.md) — `{timestamp}-{6-digit-seq}-{table_name}.cjs`, timestamp /
  creation-order ordering, `_suite`, release-dir naming (§3)
- [id-numbering.md](./references/id-numbering.md) — the 10,000-wide id-block rule, the block tables,
  FK references, structured ids, master exemption, legacy blocks (§4); keeping every value distinct
  across columns so a test mix-up is caught (§7)
- [development-coverage.md](./references/development-coverage.md) — what rows a `development/` seeder
  must hold: success / failure / error cases and status variety, and per-row case labeling (§6)
