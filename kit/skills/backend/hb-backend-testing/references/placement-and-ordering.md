# Placement & execution order

Where a test file goes, and how DB-writing tests are ordered so they do not corrupt each other.
Referenced from §1 of [SKILL.md](../SKILL.md). Directory and category names are the recommended
layout with illustrative fakes.

## The two locations

Every test file lives in exactly one of two places, chosen by **whether it writes to the database**.

| Location | Put here | Ordering |
| --- | --- | --- |
| `tests/__tests__/` | tests that **do not** write to the DB — pure units, read-only queries, formatters, validators | none needed; run in any order |
| `tests/_orders/<Category>/` | tests that **do** write to the DB — anything that inserts/updates/deletes rows | guaranteed **within a category** by a `_.test.js` barrel |

- Mirror the source tree inside `tests/__tests__/` so a unit's test sits at the matching path.
- Under `tests/_orders/`, group by a **category** (a cohesive area of write behavior); each category is
  its own folder.
- **Classify by what the method _does_, not by whether the test mocks the write away.** A method that
  writes to the DB directly or transitively (calls `create` / `update` / `destroy` /
  `beginTransaction`, or orchestrates sub-methods that do) belongs in `_orders` **even if the test
  stubs the persist call** — mocking the write does not move it to `__tests__`.
- **Placement is per-method, so one class usually splits across both trees.** A DB-writing class
  keeps its writing methods in `_orders` and its non-writing methods (`find~`, getters, builders,
  validators, `format~`) in the sibling `__tests__` file. Do not dump a read-only method into
  `_orders` just to keep it beside the class's other tests — keeping tests together is not a reason
  to place it there.

## Why DB-writing tests need ordering

A DB-writing test mutates the **shared seed fixtures** (`development` / `dev-master`) that the running
database was seeded with. Because the database is shared across the tests in a run, a test that runs
**after** a mutation observes the changed state.

- Read-only tests can't change what others see, so they never need ordering (hence
  `tests/__tests__/`); DB-writing tests can, so their run order must be **deterministic**, not left
  to file-discovery order.

## The `_.test.js` order barrel

Each category folder contains a `_.test.js` that **imports the category's test files in the exact
order they must run**. Jest discovers `_.test.js`, and its import order becomes the execution order.

```js
// tests/_orders/<Category>/_.test.js
// Imports define the run order for this category; add each new test in its correct position.
import './CreateRecord.js'
import './UpdateRecord.js'
import './DeleteRecord.js'
```

- The individual test files in the folder are **imported by the barrel**, not discovered independently
  — name them so they are not matched as standalone tests by the runner, and let `_.test.js` be the
  single entry point for the category.
- When you add a DB-writing test, add one `import` line to the category's barrel at the position where
  it must run (e.g. after the test that creates the row it depends on).

## Cross-category isolation via CI

`tests/_orders` guarantees order **within** a category, but **not across** categories — two categories
run independently and may both mutate overlapping seed data. When two categories can interfere, run
them in **separate CI jobs** so each starts from its own fresh database.

- Add or update a **per-category** workflow under `.github/workflows/` that runs only that category's
  path. Two interfering categories then never share a database within a single job.

```yaml
# .github/workflows/test-<category>.yml — one interfering category, isolated in its own job/DB
name: test <Category>

on:
  pull_request:
    branches:
      - '**'

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      NODE_ENV: development
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test -- --seeded tests/_orders/<Category>/
```

- The default catch-all workflow can run the rest of `tests/_orders/`; peel a category **out** into its
  own workflow only when it demonstrably interferes with another.
