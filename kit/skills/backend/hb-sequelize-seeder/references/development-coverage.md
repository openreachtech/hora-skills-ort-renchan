# Development fixtures cover the app's operational cases

How to decide *what rows* a `development/` seeder holds. Referenced from §6 of `SKILL.md`.
For where `development/` sits among the directories see
[directory-structure.md](./directory-structure.md); for the suite / id-block mechanics see
[naming.md](./naming.md) and [id-numbering.md](./id-numbering.md).

## Seed every case the app can produce, not just the happy path

`development/` fixtures exist so unit tests (local + CI) have realistic rows to read
([directory-structure.md](./directory-structure.md)). A test can only exercise a branch if a row
matching that branch already exists. So a `development/` seeder must **comprehensively cover the
cases that arise in the app's operation**, not only the normal success path:

- **Success cases** — valid, normal operations that go through.
- **Failure cases** — operations rejected by a business rule (validation failure, insufficient
  balance, expired window, over-limit, …). The row is well-formed but represents a "no" outcome.
- **Error cases** — abnormal / exceptional states the code must still handle gracefully
  (inconsistent or partially-written data, a record whose expected relation is missing, an
  unexpected status, …).
- **Status variety within the success cases** — even among rows that "succeed", prepare a row for
  **every distinct status** the entity defines (e.g. a user in `pending` / `active` / `suspended` /
  `withdrawn`), so each status branch has a fixture to read. (Those status values are illustrative;
  use the statuses the entity actually defines.)

- **Why**: if the fixtures hold only happy-path rows, tests for failure / error / status-specific
  behavior have nothing to read, and each such test ends up fabricating its own rows inline —
  repetitive, and drifting from the shape of real data. Comprehensive fixtures let a test pick the
  row that matches the case under test. A missing case means that branch is either untested or
  tested against ad-hoc data. This is the same QA stance the rest of these skills take: do not let
  coverage be decided by whatever the fixtures happen to contain.

## Make each row's case readable

Because one table now holds rows for several different cases, label which case each row represents
so a test author can pick the right one at a glance.

- Add a short comment per row (or per group of rows) naming the case
  (`// active`, `// suspended`, `// payment failed`, `// orphaned — error path`).
- Keep the rows inside the suite structure and the 10,000-wide id block
  ([id-numbering.md](./id-numbering.md)); group a status's rows on adjacent ids so the block reads as
  a case list.

```js
// Good example (a customers suite covering the status range, plus a failure / error row)
const seeds = [
  { id: 100001, status: 'active', /* ... */ },     // active — normal
  { id: 100002, status: 'pending', /* ... */ },    // pending — awaiting approval
  { id: 100003, status: 'suspended', /* ... */ },  // suspended — blocked by an admin
  { id: 100004, status: 'withdrawn', /* ... */ },  // withdrawn — soft-left
  { id: 100005, status: 'active', /* ... */ },     // active but a downstream op will fail (failure-case source)
  { id: 100006, status: 'active', /* ... */ },     // relation intentionally missing (error path)
]
```

```js
// Bad example (only the happy path — suspended / withdrawn / failure / error branches have no fixture)
const seeds = [
  { id: 100001, status: 'active', /* ... */ },
  { id: 100002, status: 'active', /* ... */ },
]
```

## Scope it to what the app actually branches on

"Comprehensive" means every case the code distinguishes — not a combinatorial explosion. Enumerate
the statuses / outcomes the app's logic actually branches on and seed one representative row per
branch, plus the failure / error rows the paths must handle.

- Where two axes interact (status × plan, say) and a test needs the combination, add that
  combination as its own labelled row — do not try to seed every possible pair.
- This coverage rule is for `development/` (operational fixtures) only. It does **not** apply to
  master / dev-master, which hold canonical config data, not operational case variety
  ([directory-structure.md](./directory-structure.md)).
