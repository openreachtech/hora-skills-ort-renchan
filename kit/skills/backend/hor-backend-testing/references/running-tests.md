# Running tests

How to run the whole suite, a single test (with and without rebuilding the database), reset the
database piecemeal, size the worker/heap budget so a run cannot take the machine down, and what a
live (real-dialect) run requires. Referenced from §2 of [SKILL.md](../SKILL.md). Commands are the
recommended shape; adapt the script names to your project (they are defined in `package.json`).

## The whole suite

```bash
npm run test
```

- Runs on **SQLite** — the local default (fast, zero external services), under
  `NODE_ENV=development`.
- **Rebuilds the database first**, then runs, so every full run starts clean:
  1. teardown (drop the local DB)
  2. migrate (recreate the schema)
  3. seed (master, then the development / dev-master fixtures)
  4. run `tests/__tests__/` (read-only) and `tests/_orders/` (DB-writing, in category order)

Because the suite re-seeds up front, a green full run proves the tests pass **from a clean database in
the committed order**. It is the authoritative run — and the slowest.

## Parallelism and memory: the worker budget

Jest runs test files in **parallel workers** — roughly one per core by default — and each worker is
its own Node process with its own heap. Two levers set the budget, and they must be set **together**:

```bash
# the shape — the numbers come from the measurement below, never from a default
NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=1536" npx jest --maxWorkers=4
```

- **`--max-old-space-size` is a ceiling, not a reservation.** It does not set memory aside; it is
  the point up to which V8 may **defer garbage collection**. A generous value therefore gives no
  headroom — it just lets each worker grow that far before the GC is forced to run. Set it above
  what the machine can actually give and the limit never engages: the worker keeps growing until the
  **operating system**, not V8, ends it — and **one worker is enough** to take the machine down.
- **The budget is a multiplication.** Every worker may sit at its peak at once, so the invariant is:

  ```
  workers × (heap cap + per-process overhead) ≤ memory actually free
  ```

  "Actually free" means what is left **after everything else resident on the machine** — a local
  database, an E2E stack's daemons and pollers — not the installed total.
- **Derive the cap from a measured peak, not from hope.** Run the suite once with `--logHeapUsage`
  (Jest prints each test file's heap as it finishes) and set the cap comfortably above the largest
  value. A cap below the real peak thrashes the GC and fails anyway; a cap far above it only shifts
  where the crash happens — from V8's out-of-memory error (which comes with a trace) to the
  machine's (which comes with nothing).
- **The budget goes stale as the project grows.** Per-worker usage rises with every model, seeder
  and test added, so a workers × cap pair that fit when it was chosen silently stops fitting. When a
  previously green suite starts dying without output, **re-measure the peak and re-do the
  multiplication** before suspecting the tests.

You can tell the two failures apart by how each announces itself: a worker stopped **by the cap**
throws `JavaScript heap out of memory` with a stack trace; a worker stopped **by the machine** is
killed silently and can take the whole run — and every other process on the box — with it.

### Check the machine first, then dial parallelism to fit it

The default worker count (one per core) is sized for an **idle** machine with nothing else resident.
A real developer machine rarely is: an editor, a browser, a local database, and, worst of all, a
running E2E stack's daemons and pollers are all holding memory before the suite starts. So **read
the machine's actual free resources before a full run**, and set the workers to what is free, not to
what is installed:

```bash
# free memory and core count — the two inputs to the worker budget above
free -h            # Linux: the "available" column is what a run may actually use
nproc              # cores — the ceiling on useful workers
# macOS equivalents: `vm_stat` (free/inactive pages) and `sysctl -n hw.ncpu`
```

- **When the machine is under pressure, lower `--maxWorkers` before anything else.** The budget is
  `workers × (heap cap + overhead) ≤ available memory`; when `available` shrinks because something
  else is resident, the only lever that keeps the product ≤ available without re-measuring the heap is
  the worker count. Halve it and re-run — `--maxWorkers=2`, then `1` — rather than letting the OS pick
  which process to kill. `--maxWorkers=50%` expresses it as a fraction of cores when the constraint is
  CPU rather than memory.
- **If one worker's cap already approaches what is free, go serial.** When even a single worker at
  its measured peak does not comfortably fit beside what else is resident, there is no room left for
  parallelism — run the suite in-band:

  ```bash
  NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=1536" npx jest --runInBand
  ```

  `--runInBand` runs every test file in the **main process, one after another**, so the peak is one
  worker's, not `workers ×` it. It is slower, but a serial run that finishes beats a parallel one the
  OS kills halfway. This is the same flag the single-test fast loop uses for DB-writing tests below —
  there for correctness, here for memory; both reasons point the same way on a constrained machine.
- **Bring the E2E stack down before a full run, or count it in.** A running E2E stack
  ([hor-build-e2e-test-environment](../../hor-build-e2e-test-environment/SKILL.md)) is capped, but its
  capped footprint is still spent memory: subtract it from `available` before doing the
  multiplication, or run `e2e/down.sh` first so the suite has the machine. Size the run with the
  stack counted in.

## A single test through the suite runner

Run the runner against **one path**, choosing which seed set the database has. It re-establishes the
seeds, then runs only that path:

```bash
# with the development (dev-master) seeds applied — the usual mode for a DB-writing test
./test.sh --seeded tests/_orders/<Category>/SomeCreator.js

# with master seeds only (no development fixtures)
./test.sh --empty tests/__tests__/<path>/SomeUnit.js
```

- **`--seeded`** applies the development fixtures before running; **`--empty`** runs against master
  seeds only.
- Point the path at a category's `_.test.js` to run the whole category in order, or at a single file.

## A single test without rebuilding the database (fastest)

For a tight edit-run loop, invoke Jest **directly** against the file — this skips migrations and
seeders entirely and runs against the database **exactly as it currently is**:

```bash
NODE_OPTIONS="--experimental-vm-modules" NODE_ENV=development npx jest <path-of-test-file>
```

For a DB-writing or order-sensitive test, run the cases **serially** with `--runInBand` (no parallel
workers racing on the same database):

```bash
NODE_OPTIONS="--experimental-vm-modules" NODE_ENV=development npx jest --runInBand <path-of-test-file>
```

- **Prerequisite: the database must already be prepared** (migrated + seeded once). This mode does not
  set anything up — it assumes the schema and fixtures the test expects are already present. Prepare
  them once with `npm run test` (or the piecemeal commands below), then iterate with `npx jest`.
- `--experimental-vm-modules` is required for the ES-module test loader; `NODE_ENV=development`
  selects the SQLite config.
- **`_orders` caveat**: a DB-writing test **mutates shared state**. After running one this way, the
  database no longer matches its seeded baseline, so a later fast run can produce a **different
  result**. Before trusting subsequent runs, **restore the database** — re-run the relevant migrations
  / seeders (below), or a full `npm run test`.

## Preparing or resetting the database piecemeal

When you only need to re-establish part of the state — instead of a full rebuild — run just that
step. This is what makes the fast `npx jest` loop usable.

**Migrations only** (schema):

```bash
npm run db:teardown                    # drop the local DB
NODE_ENV=development npm run db:setup   # re-apply migrations (schema only, no data)
```

**One seeder set only** — undo or (re)apply a single set without touching the others. The general
lever is `sequelize-cli` with an explicit `--seeders-path`:

```bash
NODE_ENV=development npx sequelize-cli db:seed:undo:all --seeders-path sequelize/seeders/<set>/
NODE_ENV=development npx sequelize-cli db:seed:all       --seeders-path sequelize/seeders/<set>/
```

The three standard sets, and the npm wrappers the project provides for the common two:

| Seeder set (dir) | Undo | (Re)apply |
| --- | --- | --- |
| dev-master fixtures (`sequelize/seeders/dev-master/`) | `sequelize-cli db:seed:undo:all --seeders-path sequelize/seeders/dev-master/` | `npm run db:seed:master` |
| development fixtures (`sequelize/seeders/development/`) | `sequelize-cli db:seed:undo:all --seeders-path sequelize/seeders/development/` | `npm run db:seed:dev` |
| production master (`sequelize/seeders/master/`) | `sequelize-cli db:seed:undo:all --seeders-path sequelize/seeders/master/` | `sequelize-cli db:seed:all --seeders-path sequelize/seeders/master --debug` |

- Prefix each `sequelize-cli` / `npm run` command with `NODE_ENV=development` (SQLite).
- **After running `_orders` tests**, re-applying the mutated seeder set (undo → apply) is usually
  enough to get back to a known baseline without a full teardown/migrate.
- The rebuild-everything shortcut is `npm run db:refresh` (alias `npm run r`): teardown → migrate →
  seed dev-master → seed dev, in one command.

## A live (real-dialect) run

Everything above runs on **SQLite**, the local default. A test that depends on real-dialect behavior
SQLite does not emulate has to run against **MariaDB**, and that means **a MariaDB running locally**;
`NODE_ENV=live` selects its connection config, and the same test files run unchanged — only the
dialect differs.

Standing that database up is deliberately **not covered here**: this skill governs where tests go and
how they are run, not how a database is provisioned.
