# Normalization and scaling reads

Third normal form as the default table shape, and how to add read capacity when data grows without
denormalizing the canonical tables. Referenced from [SKILL.md](../SKILL.md); this is the direct
application of its
[grand principle](../SKILL.md#grand-principle-the-database-holds-canonical-normalized-truth) to
redundancy.

## Normalize to third normal form; denormalize only as a separate, additive structure

Design every table to **third normal form (3NF)** by default: each non-key column depends on the
whole key and nothing but the key, and no fact is stored in two places. When read performance
degrades as data grows, **do not** denormalize the canonical tables — add a **separate** structure
beside them:

- a **summary / read-model table**, named with a **`summary_` prefix** (`summary_order_listings`),
  rebuilt from the canonical tables; or
- an external **search database** (Elasticsearch, etc.) for full-text or faceted search.

- **Why**: normalization keeps the responsibility boundaries sharp and the structure flexible (the
  [grand principle](../SKILL.md#grand-principle-the-database-holds-canonical-normalized-truth)). A
  denormalized column copied into the core (e.g. a customer's name cached onto every order row) has
  two owners: it drifts the instant the source changes, and it freezes the schema because now two
  places must be updated together. Putting the derived data in a **separate, prefixed, rebuildable**
  table (or a search DB) keeps the canonical tables as the sole source of truth — the summary can be
  dropped and regenerated at any time without data loss.
- The `summary_` prefix / a distinct search DB is a **signal**: "this is derived, not
  authoritative." Never let application writes treat a summary row as the source of truth.

```
-- Good: canonical stays normalized; the fast read path is a separate, rebuildable table
orders            (id, CustomerId, OrderStatusId, ordered_at, ...)   -- canonical truth
customers         (id, name, ...)                                    -- canonical truth
summary_order_listings (id, OrderId, customer_name, status_label, ...) -- derived, rebuildable
```

```
-- Avoid: customer_name copied onto the canonical table "to make the listing query fast"
orders (id, CustomerId, customer_name, ...)   -- drifts when the customer is renamed; two owners
```
