---
name: hor-backend-testing
description: >
  Organize and run the backend repository's tests: where a test file goes (tests/__tests__ for
  tests that do not write to the database, tests/_orders for tests that do), how run order among
  DB-writing tests is guaranteed, how to run the whole suite or a single test, and the purity
  rules for tests and their doubles. Use whenever the user asks where to place a test, how to
  guarantee test order, how to run tests, or how to keep tests pure. Manual E2E verification is
  out of scope.
---

# Backend Testing

A skill for **implementing tests in a backend repository**: **where** each test file belongs, **how**
DB-writing tests are ordered so they do not corrupt each other, **how** to run them, and the
**purity** rules that keep a failing test meaningful. It governs test *organization and discipline* —
the *writing style* of an individual test (describe/test structure, case data, naming) follows the
project's own Jest conventions and is out of scope here.

> This skill states a **general, project-independent rule**, not one repo's current tree. The
> directory names (`tests/__tests__`, `tests/_orders`, `tests/mocks`, `tests/tools`) are the
> **recommended layout** — map them onto your project. Sample code follows the project's lint style
> (no semicolons, 2-space indent, trailing commas).

## Core principle: a test fails only when the code under test is wrong

A test must fail **only** because the code it exercises is wrong — not because another test ran
first, and not because the test itself contains untested logic. Two rules enforce that, and
everything below follows from them:

1. **Isolate database state.** A test that **writes to the DB** mutates shared seed data that other
   tests read, so it is placed **apart** from tests that don't, and **ordered** among its peers.
2. **Keep tests pure.** A test may only exercise code that is **itself already tested** — no logic is
   invented inside a test, and every mock/tool it leans on has its own test cases.

## 1. Placement & execution order

Split every test by one question: **does it write to the database?**

| Location | Contents | Ordering |
| --- | --- | --- |
| `tests/__tests__/` | tests that **do not** write to the DB (pure units, read-only) | order-independent — run in any order |
| `tests/_orders/<Category>/` | tests that **do** write to the DB | order-**guaranteed within a category** via a `_.test.js` barrel |

- **Why the split.** A DB-writing test changes the shared `development` / `dev-master` seed fixtures,
  so a later test can observe a mutated database. Read-only tests can't interfere, so they need no
  ordering; DB-writing tests must be ordered.
- **The order barrel.** Each category folder holds `_.test.js` that **imports its test files in the
  order they must run** — that import order *is* the execution order within the category.
- **Cross-category order is NOT guaranteed.** `_orders` fixes order *within* a category only. If two
  categories can interfere, isolate them into **separate CI jobs** — add/update a
  `.github/workflows/*.yml` per category so each runs against its own fresh database.
- **Verification against real middleware belongs in neither location.** Exercising the product
  against a real broker, search cluster and change-data-capture pipeline needs those services brought
  up in Docker and is done **by hand, outside `tests/` entirely** — see the E2E environment
  convention. No such file is added here, and `npm run test` stays runnable with nothing but Node
  installed.

Details, the barrel example, and the per-category workflow snippet are in
[placement-and-ordering.md](./references/placement-and-ordering.md).

## 2. Running tests

- **Whole suite**: `npm run test` — rebuilds the DB (teardown → migrate → seed) and runs everything on
  **SQLite** (the local default). Authoritative, slowest.
- **A single test (fast, no rebuild)**: iterate by invoking Jest directly against one file —
  `NODE_OPTIONS="--experimental-vm-modules" NODE_ENV=development npx jest <path>` (add `--runInBand`
  for DB-writing/order-sensitive tests). It runs against the DB **as it currently is**, so prepare the
  DB once and reset it piecemeal (migrations-only / one-seeder-set) instead of a full rebuild.
- **Live (real-dialect) run**: running against MariaDB instead of SQLite **requires a MariaDB
  running locally**, selected with `NODE_ENV=live`. How that database is stood up is not part of this
  convention.
- **Parallelism × per-worker heap must fit in real memory.** Jest runs one worker per core by
  default, and `--max-old-space-size` is **not a reservation — it is how far the GC may be
  deferred**, so a value the machine cannot actually give lets every worker grow until it crashes
  the machine (one worker alone can do it). Derive the cap from a **measured peak**, check that
  workers × cap fits in the memory actually free, and re-check as the project grows: per-worker
  usage rises with every model and seeder added, so a pair that fit at the start can later crash the
  machine.

The exact commands, the suite runner's steps, the fast single-test loop with the piecemeal DB
reset, and how to size the worker/heap budget are in
[running-tests.md](./references/running-tests.md).

## 3. Test purity & test doubles

- **No new logic in a test.** Never define a function or class inside a test to compute an expected
  value or stand in for production behavior — an untested helper can be wrong, making the test lie.
  Assert against literal expectations.
- **Everything a test uses must already be tested.** Every function, class, mock, and tool the test
  leans on has its own test cases.
- **Doubles live under `tests/`, and are themselves tested.** Mocks go in `tests/mocks/`, shared test
  tools/factories in `tests/tools/`, and **each mock class has its own test file**. Prefer explicit
  fakes (obviously-fake names/values).

The rule with good/avoid examples, and the mocks/tools layout, are in
[purity-and-mocks.md](./references/purity-and-mocks.md).

## Finishing checklist

- [ ] The test is in `tests/__tests__/` if it does no DB write, or `tests/_orders/<Category>/` if it does ([§1](#1-placement--execution-order)).
- [ ] A DB-writing test is imported (in the right position) by its category's `_.test.js` barrel.
- [ ] If the new test's category can interfere with another, a per-category CI workflow isolates them.
- [ ] The test defines **no** new logic; every function/class/mock it uses is already tested ([§3](#3-test-purity--test-doubles)).
- [ ] Any new mock/tool lives under `tests/mocks/` or `tests/tools/` and has its **own** test file.
- [ ] Verified with a single-test run ([§2](#2-running-tests)).

## Detail files

- [placement-and-ordering.md](./references/placement-and-ordering.md) — `__tests__` vs `_orders`, why
  DB-writing tests need ordering, the `_.test.js` order barrel, cross-category isolation via
  per-category CI workflows (§1)
- [running-tests.md](./references/running-tests.md) — the whole-suite runner and what it does, running
  a single test with the dev/master seed sets, resetting the database piecemeal, sizing the
  parallelism × heap budget against real memory, and what a live (real-dialect) run requires (§2)
- [purity-and-mocks.md](./references/purity-and-mocks.md) — no-new-logic and only-tested-code rules
  with good/avoid examples, and the `tests/mocks` / `tests/tools` layout where doubles are themselves
  tested (§3)
