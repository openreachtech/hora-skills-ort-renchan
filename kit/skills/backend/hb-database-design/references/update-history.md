# Update history (the archive pattern)

How to retain a table's change history without bloating the live table. Referenced from
[SKILL.md](../SKILL.md). The mixin that implements this is written per `hb-sequelize-model`.

## Keep a table's update log with the archive pattern

When you need to retain the **update history** of a table, use the **archive pattern** as the base
pattern: keep the live table holding only the **current** row, and on every save **append** a copy
of the row's business attributes — as a new generation — to a **parallel archive table**. Do not
keep history by piling every revision into the live table (a `is_current` flag, per-row version
numbers).

- **Why**: the live table stays small and single-purpose — "the current state" — so ordinary
  queries need no "and it's the current one" filter and its indexes/constraints stay simple. The
  full history lives in an **append-only** companion that never complicates the main table. Folding
  current and historical rows into one table bloats it, slows every query, and muddies uniqueness
  constraints. History is a separate, additive structure (the
  [grand principle](../SKILL.md#grand-principle-the-database-holds-canonical-normalized-truth)),
  exactly like the summary tables in [normalization.md](./normalization.md).
- **Mechanics**: renchan implements the archive pattern with `BackupMixinModel` + a `*_bk` table
  (e.g. `customer_orders` → `customer_orders_bk`): on `afterSave` it appends the business attributes
  (excluding `id` / `created_at` / `updated_at` / `deleted_at`) plus a `saved_at` generation marker.
  Pass the mixin from the live model; see the mixin catalog in `hb-sequelize-model`.

```
-- Good: live table = current state; archive table = append-only generations
customer_orders     (id, CustomerId, OrderStatusId, ...)          -- current row only
customer_orders_bk  (id, CustomerOrderId, ...business attrs, saved_at)  -- one appended row per save
```

```
-- Avoid: history crammed into the live table
customer_orders (id, ..., version_no, is_current)   -- every query filters is_current; table bloats
```
