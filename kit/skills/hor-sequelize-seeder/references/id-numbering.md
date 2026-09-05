# Id numbering (6-digit, 10,000-wide blocks)

How seed-row ids are allocated. Referenced from §4 of `SKILL.md`.

## The rule: a 6-digit, 10,000-wide id block per seeder / per table

**Every seed row has an explicit `id`, and each table's rows occupy a distinct id block whose step
is 10,000.** Bases are multiples of 10,000 **at or above `100000`** (6 digits): `100000`, `110000`,
`120000`, … Rows increment by 1 inside the block, so a block holds up to ~10,000 rows.

- **Explicit ids, never auto-increment.** `down` deletes by the exact id list
  (`seeds.map(it => it.id)`), and other seeds' FK columns point at known ids — both need the id to
  be fixed in the source.
- **Bases are 6 digits (`≥ 100000`).** Never use a sub-100,000 base (`1000`, `10000`, …). A 6-digit
  id is larger than `SMALLINT`'s maximum (32,767 signed / 65,535 unsigned), so if a column was
  mistakenly declared `SMALLINT` in the migration, the seed insert **overflows and fails at seed
  time** — you catch the schema mistake while running the seeders, not later in production. This is
  why ids go in the 100,000+ range rather than smaller blocks.
- **The step is 10,000.** Allocate the next free multiple of 10,000 (at or above 100,000) as a new
  seeder / table's base; never let two blocks overlap in a way that could collide within a single
  table.
- **A base may be reused across suites.** `customers` and `admins` both start at `100000` — safe,
  because the rows land in different tables. Uniqueness only has to hold *within one table*.

## Development suites: a base per table within the suite

A `development/` suite gives each table *within the suite* its own 10,000-step base, and the same
bases recur across suites:

| Table position in the suite | id base | example rows |
| --- | --- | --- |
| 1st (root — `customers` / `admins`) | `100000` | `100001`, `100002`, … |
| 2nd (`*_basics`) | `110000` | `110001`, `110002`, … |
| 3rd (`*_secrets`) | `120000` | `120001`, … |
| 4th (`*_password_hashes`) | `130000` | `130001`, … |
| 5th (`*_access_tokens`) | `140000` | `140101`, `140201`, … |

## FK columns reference the parent block's ids

A seed's foreign-key column holds an id drawn from the referenced table's block, so the reference is
readable and stable.

```js
// software_package_options rows point at software_packages rows by their block ids
{ id: 530001, software_package_id: 520001, /* ... */ }
{ id: 530002, software_package_id: 520002, /* ... */ }

// customer_basics rows point at customers rows
{ id: 110001, customer_id: 100001, /* ... */ }
```

- This is why bases must be **predictable**: you allocate the parent's block first, then reference
  those exact ids from the child block.

## Hierarchical rows: a structured id inside the block

For rows that fan out per parent, encode the hierarchy into the id while staying **inside the
10,000 block**. Access tokens use `14` + a 2-digit customer number + a 2-digit sequence:

```js
{ id: 140101, customer_id: 100001, /* first token of customer 01 */ }
{ id: 140201, customer_id: 100002, /* first token of customer 02  */ }
{ id: 140202, customer_id: 100002, /* second token of customer 02 */ }
```

- `140101` … `143001` all sit inside the `140000` block, so the structuring does not break the
  block rule.

## Production master is exempt

`master-*/` canonical data does **not** use the 6-digit 10,000-wide blocks. Its ids are small
sequential (`1`…`7`) or taken from `app/constants` (`AI_PROVIDER.DEFAULT.ID`).

- **Why exempt**: master ids are part of the product — stable, meaningful, and often referenced by
  application code through a constant. A big fixture block would obscure that. Blocks are for
  *fixture* data (`development/`, and dev-only samples in `dev-master/`), where the goal is
  non-collision, traceability, and (via the 6-digit range) catching a `SMALLINT` mistake, rather
  than a meaningful value.

## Why 6-digit blocks at all

- **SMALLINT detection**: a `≥ 100000` id overflows a `SMALLINT` column, so a wrong column type
  fails at seed time instead of silently truncating.
- **Deterministic**: `down` removes exactly what `up` inserted.
- **Non-colliding within a table**: two seeders never fight over an id in the same table.
- **Cross-seed FKs resolve**: a child seed can hard-reference a parent id because the parent's block
  is known.
- **Traceable**: a row's id tells you which seeder / table it came from at a glance.

## Keep different columns' values distinct (so a test mix-up is caught)

Beyond ids, choose seed values so that **the same value never appears in two different columns**. The
block scheme already does this for ids — a row's `id` (its own table's block) and its FK columns
(the *parent* table's block) always fall in different ranges, so they never share a value. Extend the
same discipline to every column.

- **id vs same-row FK / numeric columns**: keep them in different ranges. If a row's `id` is
  `100001`, a `user_id` on that row must sit in a different block (e.g. from `110001`), never
  `100001`. With the 6-digit 10,000-wide blocks this is automatic (`id: 110001` alongside
  `customer_id: 100001`) — do not flatten them back onto the same value.
- **text columns**: give `username` and `name` (or any two string columns) **different** values;
  never reuse one string for both.
- **Why**: if `id` and `user_id` are both `100001`, a unit test that accidentally reads `user_id`
  where it meant `id` still matches a row and **passes** — a false positive that hides the bug.
  Distinct values make the mistake fail loudly, and make it obvious, from the value in the failure
  output, which seeder and column are involved. (This is the seeder counterpart of keeping test-case
  values unique.)

```js
// Bad example (id == user_id, and username == name — a column mix-up would pass silently)
{ id: 100001, user_id: 100001, username: 'taro', name: 'taro' }

// Good example (every column in its own value range / space)
{ id: 110001, user_id: 100001, username: 'user-110001', name: 'Alpha Taro' }
```

## Blocks already in use

These tables already occupy the following 6-digit blocks; do not reuse a base for a new seeder in
the same table:

| Table | id base |
| --- | --- |
| `content_plan_rates` | `500000` |
| `content_benchmark_samples` | `510000` |
| `software_packages` | `520000` |
| `software_package_options` | `530000` |
| `integration_clients` | `600000` |

- A child table's block sits above its parent's so FK ids stay readable
  (`software_package_options` `530000` references `software_packages` `520000`).
- Older seeders that were written before the 6-digit rule and still sit on a narrower / sub-6-digit
  block should be renumbered into a 6-digit block (above) the next time they are touched.
