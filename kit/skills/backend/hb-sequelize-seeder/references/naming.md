# Naming (filename, ordering, suites)

How to name a seeder file and why the ordering matters. Referenced from §3 of `SKILL.md`.

## Filename `{timestamp}-{6-digit-seq}-{table_name}.cjs`

A new seeder filename is a creation timestamp, a 6-digit running sequence, then the table name:
`20260717135803-000001-customers.cjs`, `20260717140512-000002-content_plan_rates.cjs`.

- **`{timestamp}`** is the creation time `YYYYMMDDHHmmss` (14 digits; `date +%Y%m%d%H%M%S`), matching
  the migration convention
  (`hb-sequelize-migration`).
  Files are applied in **ascending timestamp order** — i.e. in creation-time order.
- **`{6-digit-seq}`** is a zero-padded running number (`000001`, `000002`, …). It orders files that
  share a timestamp and doubles as a human-facing identifier.
- **`{table_name}`** is the physical table name in **snake_case** — the same name as the seeder's
  `TABLE_NAME` and the migration's table. For a **suite** that fills several related tables, use the
  domain root + `_suite` (`customers_suite`, `admin_roles_suite`).
- Examples: `20260717135803-000001-customers.cjs`,
  `20260717141020-000002-customers_suite.cjs`,
  `20260717142230-000003-ai_model_tool_assignments.cjs`.
- **Older seeders** predate this and use the `<8-digit-seq>-<kebab-entity>.cjs` form
  (`00050002-ai-models.cjs`). Leave them as-is; write **new** files in the timestamp form above.

## Ordering is by timestamp (creation order) — seed parents before children

sequelize-cli runs seeders in **filename order**, which under this scheme is **ascending timestamp =
creation order** (the same as migrations). A child seed can only reference a parent id that already
exists, so the parent's rows must be inserted first.

- **Within a suite**, the file itself inserts parent → child (and deletes child → parent), so most
  FK dependencies are satisfied inside the one file ([notation.md](./notation.md)).
- **Across files**, create the parent's seeder **before** the child's, so its timestamp is earlier
  and it runs first. (This replaces the older scheme, where an 8-digit prefix mirrored the migration
  domain group to force the order; with timestamps, creation order does the same job.)

## Suites bundle a domain's tables under one `_suite` file

A `*_suite.cjs` file seeds a whole cluster of related tables in one place (root + its dependent
tables), with `TABLE_NAME` as an object and parent→child insert / child→parent delete
([notation.md](./notation.md)).

- Use a suite when the tables are only meaningful together (a customer plus its basics, secrets,
  password hash, access tokens). Use a plain single-table name otherwise.

## Production master: release directory naming

Production master files live under a release-numbered directory `master-<6-digit>/`
(`master-000001/`, `master-000002/`, …) — [directory-structure.md](./directory-structure.md). The
release number lives on the **directory**; the **file** inside uses the standard seeder filename.

## A dev-master re-export keeps the same filename

A `dev-master/` file that re-exports a production master file
([directory-structure.md](./directory-structure.md)) **keeps the identical filename** as the
`master-*/` file it points at.

- **Why**: matching filenames make the correspondence obvious and keep the two directories aligned
  file-for-file, so it is easy to see which production master files have a dev / CI counterpart.
