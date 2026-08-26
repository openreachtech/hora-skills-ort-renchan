# Test purity & test doubles

Why a test may only lean on already-tested code, and where test doubles live. Referenced from §3 of
[SKILL.md](../SKILL.md). Names are illustrative fakes.

## No new logic in a test

Never define a function or class **inside a test** to compute an expected value or to reproduce
production behavior. Logic written in a test is **untested logic**: if it is wrong, the test passes (or
fails) for the wrong reason — the test lies instead of catching the bug.

```js
// Avoid: an untested helper defined in the test computes the expectation
function buildExpectedLabel ({
  first,
  last,
}) {
  return `${last} ${first}` // if this is wrong, the assertion is meaningless
}

expect(formatLabel(input))
  .toBe(buildExpectedLabel(input))
```

```js
// Good: assert against a literal expected value — no logic in the test
expect(formatLabel({
  first: 'Ada',
  last: 'Byte',
}))
  .toBe('Byte Ada')
```

- Assert against **literals** (or values a test fixture already provides), not against something the
  test recomputes.
- If the expectation is tedious to write out, that is a signal to build a **tested** fixture/factory
  (below), not to inline a calculation.

## Everything a test uses must already be tested

Every function, class, mock, and tool a test leans on has its **own** test cases. The chain of trust
only holds if each link is verified:

- Exercising production code A that internally calls B is fine — B is production code with its own
  tests. What is banned is **new** code that exists only to serve the test and has no tests of its own.
- If a test needs a helper to build inputs or doubles, that helper is a **tested tool** (below), not an
  inline function.

## Mock only when necessary — default to real

A method that **can** run for real must not be mocked: mocking the very behavior a test exists to
verify lets a hard-coded or regressed implementation still pass. Reach for a mock in only two cases —
**external systems** (third-party APIs that must never be hit, in success *and* failure tests) and
**steering an otherwise-unreachable branch** (e.g. forcing a not-found guard that seeded data cannot
naturally trigger).

- **Never mock a database row — add a seeder instead.** DB-touching tests read real seeded data; if
  the data you need is missing, extend the seed fixtures rather than stubbing a row. Stubbing a call
  that could have run for real, or mocking rows, is over-mocking and defeats the test.
- **Don't hand-query the DB inside a test to check a result.** Assert only the return value of the
  method under test; never call `Model.findOne` / `findAll` / `update` directly in the test body to
  fetch or verify state. Exercising the method *is* the test — re-reading the row yourself tests the
  ORM, not the code under test.
- A double that is *only ever* borrowed as a stub must still be exercised **for real** in its own
  test (below) — always test it too.

## Test doubles live under `tests/`, and are themselves tested

Shared test infrastructure has a home, and is held to the same bar as production code.

| Directory | Holds |
| --- | --- |
| `tests/mocks/` | mock/stub classes that stand in for a collaborator (a fake model, a fake client, a fake tokenizer) |
| `tests/tools/` | shared test tools — factories, builders, fixtures used across many tests |

- **Each mock class has its own test file.** A mock is code; an untested mock can drift from the real
  collaborator's contract and silently invalidate every test that uses it. Test the mock's behavior
  just like a unit.
- **Prefer explicit fakes** — obviously-fake class and data names (e.g. `Alpha` / `Beta` sample models,
  clearly-fake tokens) so a reader never mistakes a double for real data or production code.
- A double or tool used by exactly one test can sit beside it, but the moment a second test needs it,
  move it to `tests/mocks/` or `tests/tools/` (with its own test) rather than copy it.
