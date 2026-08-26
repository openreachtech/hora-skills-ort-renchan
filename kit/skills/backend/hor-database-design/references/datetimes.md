# Datetimes (business time vs audit time, UTC, precision)

How to model time columns: which datetimes are the framework's and which are the business's, and
how every datetime is stored. Referenced from [SKILL.md](../SKILL.md). The physical `DATE(3)` column
is written per `hor-sequelize-migration`; the model side per `hor-sequelize-model`.

## Separate business datetimes from the ORM's audit timestamps

`created_at` / `updated_at` / `deleted_at` are **audit columns managed by the ORM** — the
application does **not** read or write them. When business logic needs a creation / update /
registration time to display or to reason about, add a **dedicated, well-named column**:
`generated_at`, `modified_at`, `registered_at`, etc. (`DATE(3)`, per the UTC rule below, named per
the `_at` / `_on` rule below).

- **Why**: the audit columns' timing is not an operational guarantee — a data backfill during a
  migration rewrites `updated_at` without any business event happening, and the framework, not your
  code, supplies their values. Depending on them for business meaning couples your logic to
  framework operations and breaks silently on the next migration. A dedicated column states its
  intent in its name and is safe to read, write, sort, and expose.
- This is the same split enforced from the schema side by `hor-sequelize-model` (do not put timestamp
  columns in model attributes) and `hor-sequelize-migration` (timestamps come from the shared
  `...factory.TIMESTAMPS` preset). This skill decides *whether you need a business time column at
  all*; those skills declare it.

```
-- Good: audit columns are the framework's; business time is its own named column
articles (id, title, registered_at, created_at, updated_at)
--                        ^ business: when the author registered it (app reads/writes)
--                                         ^ audit: framework-managed (app never touches)
```

```
-- Avoid: reusing created_at as "registered at" for display
articles (id, title, created_at)   -- a migration backfill silently changes the displayed date
```

## Suffix a datetime column `_at`, a date-only column `_on`

A column that carries a **time of day** ends with `_at` (`modified_at`, `trashed_at`,
`expired_at`). A column whose meaning stops at the **calendar date** ends with `_on` (`billed_on`,
`due_on`). A value that has a range is **two columns**, each keeping the suffix — `modified_at_from`
and `modified_at_to`, never one column carrying both ends.

- **Why**: the suffix is the only place a column states its granularity. Without it (`modified_from`)
  every reader must open the migration to learn whether a time component exists, and a date-only
  value compared against an instant is off by up to a day — a bug that only surfaces near midnight.
  The same name travels unchanged into the model attribute and the SDL field, so one rename covers
  all three layers.
- `_from` / `_to` mark **the two ends of a range**. A single column meaning "in effect from this
  moment" is not a range end: name it for the instant it holds — `effective_at`, not
  `effective_from`.
- This is the column-side form of the shared naming convention's `At` / `On` rule; the model
  attribute and the GraphQL field carry the camelCase form of the same name.

```
-- Good: granularity is in the name; a range is two columns
files    (id, modified_at, trashed_at, ...)        -- instants
invoices (id, billed_on, due_on, ...)              -- calendar dates
-- a search filter over modified_at spans two columns / two inputs:
--   modified_at_from, modified_at_to
```

```
-- Avoid: granularity unstated, or a single instant named as a range end
files        (id, modified, ...)         -- date or instant? open the migration to find out
invoices     (id, billed_at, ...)        -- carries a time of day the business never means
price_tables (id, effective_from, ...)   -- one instant wearing a range-end suffix
```

## Store datetimes as UTC with millisecond precision

Every datetime column is **UTC** and typed `DATETIME(3)` (Sequelize `DATE(3)`, written per
`hor-sequelize-migration`), which keeps time to the **millisecond**. Timezone conversion is the
**application layer's** responsibility, never the database's.

- **Why (UTC)**: a timezone is a *presentational* concern (the
  [grand principle](../SKILL.md#grand-principle-the-database-holds-canonical-normalized-truth)), so
  it does not belong in the canonical store. One unambiguous instant per row means comparisons,
  sorting, and range queries are always correct, and the data survives being served to clients in
  any region or migrated across environments (dev SQLite / staging MySQL / live MariaDB). Mixing
  local times in the DB makes every `ORDER BY time` and `BETWEEN` subtly wrong.
- **Why (ms precision)**: high-frequency writes within the same second must still order
  deterministically; second precision collapses them and makes "latest row" ambiguous.

```
-- Good: UTC instant, millisecond precision; the app renders it in the user's timezone
DataTypes.DATE(3)   // stored as UTC DATETIME(3)
```
