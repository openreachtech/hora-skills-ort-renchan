# Seed data for the E2E environment

The two seeder directories the E2E stack owns, why they are separate from the unit-test fixtures, how
their ids are allocated, and the artifacts a seeder cannot carry. Referenced from §6 of
[SKILL.md](../SKILL.md). `<stack-env>` stands for the E2E stack's own environment name —
`live-local` is the recommended name, giving `live-local-master/` and `live-local/`; ids,
directory names and values are **illustrative examples**.

> Everything here is about the **system of record's rows** and is the least stack-dependent part of the
> skill: the tooling shown is Sequelize's CLI and the read model is a search index, but the rules
> below hold for any store and any seeding tool.

## Two directories of its own

| Directory | Holds | Applied by | Corresponds to |
| --- | --- | --- | --- |
| `sequelize/seeders/<stack-env>-master/` | the master / metadata rows the stack requires to run, **re-exported** from the production master, plus E2E-only master samples | `db:seed:<stack-env>-master` | the dev-master set |
| `sequelize/seeders/<stack-env>/` | the operational rows the environment is filled with, including the accounts the operator signs in with | `db:seed:<stack-env>` | the development set |

```json
{
  "db:seed:<stack-env>-master": "export NODE_ENV=<stack-env>; sequelize-cli db:seed:all --seeders-path sequelize/seeders/<stack-env>-master --debug",
  "db:seed:<stack-env>": "export NODE_ENV=<stack-env>; sequelize-cli db:seed:all --seeders-path sequelize/seeders/<stack-env> --debug"
}
```

- **The master directory is named `<stack-env>-master`, never `master-<stack-env>`.** In the
  project's seeder convention, `master-*` is the release-split **production** master namespace
  (`master-000001/`, `master-000002/`, …), applied in ascending order by `db:seed:prod` — a
  directory named into that pattern gets classified as a production release, and can be picked up by
  the production seed run. The suffix form keeps the environment name first, pairing
  `<stack-env>-master/` with `<stack-env>/` the way `dev-master/` pairs with `development/`.
- **Write seeders for a single application to an empty schema.** Every row carries an explicit id,
  so applying the set to a database that already holds it collides on insert — and that collision is
  the intended behaviour, not a gap to close. It is the environment saying *you meant `up.sh`*,
  which cleans first. Adding upserts, `IGNORE` or existence checks to make the set survive a second
  application gains nothing and gives up the guarantee that the rows in the database are the rows in
  the file ([runner-and-lifecycle.md](./runner-and-lifecycle.md)).
- The environment name is set inside the script, so forgetting an export cannot apply the seeders to
  the wrong database.
- The directory is chosen by `--seeders-path`, exactly as the existing seed sets do; the seeder file
  format stays the same (skeleton, `TimestampSeedsSupplier`, explicit ids, `up`/`down` — follow the
  project's seeder convention).
- **A file skeleton stays identical to every other seeder.** Only the *directory* says which
  environment the rows are for.

## Why not reuse the unit-test fixtures

The two sets are used by tools that need opposite shapes:

| | unit-test fixtures | E2E rows |
| --- | --- | --- |
| shape | exhaustive — every status, every branch, every null | minimal and **pipeline-shaped**: a few rows that will actually flow end to end |
| size | as large as coverage needs | as small as possible; every row becomes an entry in the read model and a change to propagate |
| churn | edited whenever a unit test needs a new case | edited only when the pipeline's shape changes |

Sharing one set couples them: a row added to satisfy a validator's edge case becomes another document
in the index and another line on a screen; a row reshaped for the pipeline breaks a unit test in a
different directory. **Separate directories make it obvious what a change can break** — and the split
is the reason the E2E build never applies the development set.

## Master rows are re-exported, never copied

Some master ids end up **inside a derived artifact** — an id written into a read-model entry (a search
document in the example), a key a mapping or a view definition is built from. If those ids differ
between environments, a read model built in one environment cannot be read or compared in another, and
rebuilding it silently produces entries that do not match the metadata.

So the stack's master set **references** the production master rather than restating it:

```js
'use strict'

/*
 * Re-export of the production master (the source of truth is
 * sequelize/seeders/<production-master-dir>/<same-name>.cjs).
 * The stack environment must load exactly the production master rows, so the data is
 * referenced, never copied.
 */

module.exports = require('../<production-master-dir>/<same-name>.cjs')
```

- **Keep the filename identical** to the file being re-exported, so the two are obviously a pair and
  the run order matches.
- **Copy-paste is the failure mode this prevents.** A copied master file diverges the first time a
  column is added to only one of them, and the symptom appears as a search result missing a field —
  nowhere near the seeder.
- **Stack-only master samples** (rows production creates through an admin screen rather than seeding)
  belong here too, as their own files with their own ids.

## Ids come from a reserved band

Follow the project's existing id rule — every row carries an **explicit** id, blocks are 10,000 wide
— but allocate the stack's blocks from a **band of their own**, starting above every block the other
seed sets already occupy:

| Seed set | Id band | Example bases |
| --- | --- | --- |
| unit-test fixtures (the project's ordinary set) | the blocks the project's seeder convention already allocates | `100000`, `110000`, `120000`, … |
| **E2E fixtures (`<stack-env>/`)** | **a band of their own, above all of those** | `800000`, `810000`, `820000`, … |
| E2E master samples (`<stack-env>-master/`) | the same band, above their parent's block | |

- **A row's origin is then readable from its id.** An id from the E2E band, seen on a screen or in a
  log, says immediately which seed set put it there — worth a lot when the same table is filled by
  two sets in two environments.
- **The two sets cannot collide on primary key** even if both are somehow applied to one database, so
  the mistake surfaces as unexpected *rows* rather than as an insert failure halfway through.
- **Foreign-key columns still hold an id from the referenced table's block**, and the band applies to
  the referenced block too — an E2E row points at E2E rows, not at unit-test rows.
- Re-exported production master files keep the **production** ids (small and meaningful). The band
  applies only to rows this set introduces.

## Seeds insert rows, not files

A seeder cannot carry a binary: committing one means maintaining it, and the real assets often
cannot be committed at all. So the rows say a file is present — a status, a size, a page or item
count — while the bytes are not on disk, and every request for the file answers 404.

A screen that opens such a record then breaks for a reason that has nothing to do with the code.
**The build therefore has a step that generates the artifacts the seeds promise**, after seeding and
before the environment is handed over:

- Generate from the rows, so the two always match — read the seeded records and write a stand-in for
  each.
- **Write only what the application actually serves** (the derived artifacts the screens or the API
  hand back). There is no original file for it to reproduce.
- **Make the stand-in obviously synthetic** — a placeholder that is unmistakable at a glance — so
  nobody takes a fixture for real data on a screen.
- **Write it under the per-run storage path** (`FILE_STORAGE_PATH` is overridden for the run), not
  into the working tree.
- **Safe to run again**: rewrite every file from scratch rather than skipping existing ones.

## Keep the set pipeline-shaped

A row earns its place here by covering a **path**, not a branch. When adding rows, prefer:

- **One complete chain** over many partial ones — a record that has everything the pipeline needs to
  produce a read-model entry, so a single row exercises the whole path.
- **Rows that make propagation visible** — distinct, recognizable text, so it is obvious at a glance
  whether something arrived rather than something being counted.
- **A deliberate negative** — one record that must *not* reach the read model (unsynced column,
  excluded category), so the filter's effect is visible too. Without one, propagating everything
  looks exactly like the filter working.
- **Nothing added just because a unit test wanted it.** That row belongs in the other set.
