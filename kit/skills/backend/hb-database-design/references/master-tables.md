# Master tables (status / category sets, and versioned masters)

How to model a fixed-ish set of reference values (statuses, categories) as data, and how to version
a master table that changes over time (a price list). Referenced from [SKILL.md](../SKILL.md). The
entity's key column is written per `hb-sequelize-migration`; the versioning mixin per `hb-sequelize-model`.

## Model status / category with a master table + a key column, not free strings

Do not store a status or category as a free-form string on the entity. Create a **master table**
(`order_statuses`) that defines the set, and give the entity a **key column** that maps to it
(the FK-like `OrderStatusId`, or a stable string key resolved against the master). Reserve `ENUM`
for sets that are **clearly closed and small**.

- **Why (not strings)**: free strings drift — `'active'`, `'Active'`, `'ACTIVE'` all appear, and a
  status carries no metadata (display label, sort order, an "is active" flag). A master table makes
  the set **queryable, extendable, and consistent**: adding a status is one row, and each status can
  carry the metadata the app needs — a system key, a display name, a display order, an active flag
  ([the standard columns below](#give-every-reference-master-table-the-standard-columns)). The status
  is *config data*, presentational and operational — exactly what the
  [grand principle](../SKILL.md#grand-principle-the-database-holds-canonical-normalized-truth) keeps
  out of ad-hoc columns.
- **Why (ENUM discouraged)**: statuses and categories almost always grow as the project runs, and
  adding an `ENUM` value requires an `ALTER TABLE` migration and still cannot hold metadata. `ENUM`
  is acceptable **only** when the set is genuinely fixed and tiny (a value that will not grow), and
  the metadata of a master table would be overkill. When unsure, use the master table — it is the
  reversible choice.
- The entity's key column is an **FK-like column** (uppercase-initial `OrderStatusId`, **no DB
  foreign-key constraint**); follow the FK-like-column rule in `hb-sequelize-migration`.
- **Name the master table for the classification it holds, in the plural: `*_statuses` for a status
  set, `*_categories` for a classification set — never `*_types`.** The entity's key column follows
  the table (`OrderStatusId`, `GranteeCategoryId`; not `GranteeTypeId`). `type` is prohibited as a
  suffix because it collides with the JSDoc type annotation, so a reader cannot tell whether the
  name means a JavaScript type or a business classification; the shared naming convention states
  the rule and its one exception (a word borrowed verbatim from an external standard, such as
  `mimeType`). The name chosen here propagates to the model, the FK-like column, and the GraphQL
  field, so getting it wrong is a three-layer rename later.

```
-- Good: the set of statuses is data in a master table; the entity references it by key
order_statuses (id, name, display_name, display_order, is_active)  -- e.g. (1, 'ordered', 'Ordered', 1, true)
orders         (id, OrderStatusId, ...)                            -- maps to a master row; add a status = one row
```

```
-- Avoid: a free string that drifts and carries no metadata
orders (id, status VARCHAR(32), ...)   -- 'active' / 'Active' / 'ACTIVE' accumulate; unqueryable set
```

## Give every reference master table the standard columns

A status / category master table (the enumerable set of reference values from the previous section)
carries a fixed set of columns beyond `id`: the **system key**, a **user-facing label**, a
**display order**, and an **active flag**.

| Column | Role |
| --- | --- |
| `id` | primary key — what the entity's FK-like key column references |
| `name` | **system key**: the stable identifier the application binds to (`'ordered'`). Machine-facing, unique, never renamed once referenced |
| `display_name` | **user-facing label** shown in the UI (`'Ordered'`). Free to reword or localize without touching logic |
| `display_order` | the order in which to present the set in the UI |
| `is_active` | whether the entry is currently selectable / in use |

- **Why split `name` from `display_name`**: application logic must key off a value that never
  changes — the system key `name`. The label users see (`display_name`) is presentational and
  changes often (wording, localization). If code keys off the display label, every rename or
  translation silently breaks a lookup; keeping the two separate lets the UI text move freely while
  logic stays pinned to the stable key. This is the metadata the master-table pattern in the
  previous section exists to hold.
- **Why `display_order` is a column, not code**: presentation order is data. A column lets the set
  be reordered without a deploy; hardcoding the order in the app couples a presentation tweak to a
  release.
- **Why `is_active` instead of deleting a row**: retiring a value by flag keeps the row — and
  therefore every historical reference to it (an order pointing at a now-discontinued status) —
  valid. Deleting the master row would orphan those references (there is no DB foreign-key
  constraint to stop it; integrity is the app's job, per `hb-sequelize-migration`). Filter to
  `is_active = true` when offering choices, and keep inactive rows for history.
- Put a UNIQUE index on `name` — it is the real key of the set; see `hb-sequelize-migration`.

```
-- Good: system key, display label, order, and active flag are all columns
order_statuses (id, name, display_name, display_order, is_active)
-- (1, 'ordered',   'Ordered',   1, true)
-- (2, 'cancelled', 'Cancelled', 2, false)   -- retired: kept for history, no longer offered
```

## Version a master table by splitting the version from its rows

A master table that manages **many records as one unit that changes over time** — a price list, a
rate table, a fee schedule — should be **versioned**. Model it as **two separate tables**: a
**version table** (one row per published version, carrying the version key, e.g. an
`effective_at` datetime — the instant the version takes effect, so it is `_at`, not `_from`) and
the **master-rows table** (the actual records, each belonging to a version). Read the version
effective at a given time; never edit a published version's rows in
place — publish a new version instead. This is the versioned form of the master-table idea above.

- **Why**: a price list is not one record, it is a *snapshot of many records that must change
  together and stay auditable*. Editing the rows in place destroys the history — you can no longer
  answer "what was the price on date X", and an order placed last month that refers to "the price
  list" silently starts reading this month's numbers. Splitting the **immutable rows of each
  version** from the **"which version applies" axis** keeps every published version intact and makes
  activating a new one a single, reversible act. It is the
  [grand principle](../SKILL.md#grand-principle-the-database-holds-canonical-normalized-truth)
  again: the canonical rows are immutable truth; the current-version selection is a separate concern.
- **Mechanics**: renchan implements exactly this with `SuiteVersionMixinModel` — the version table
  `hasMany` the master ("suite") rows, `versionKey` (e.g. `effectiveAt`) selects the version in
  effect, and `findCurrentSuite()` reads it. See the mixin catalog in `hb-sequelize-model`.

```
-- Good: the version and its rows are separate tables; a new version is a new set of rows
price_tables      (id, effective_at, ...)                          -- version table (one row per version)
price_table_rows  (id, PriceTableId, product_key, amount, ...)     -- master rows, immutable per version
```

```
-- Avoid: one flat table edited in place
price_list (id, product_key, amount)   -- no history; "which price applied when" is unanswerable
```
