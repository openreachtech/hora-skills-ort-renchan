# Testing a mutation resolver

A mutation resolver is split across **two test locations** by one question: **does the test write to
the database?** No-write tests go in `tests/__tests__/`; write tests go in `tests/_orders/`.
Everything else — `test.each`, `describe` structure, unique fake data, AAA, `jest.spyOn` mocks —
follows the project's jest rules unchanged.

> Examples use a generic `Article` resolver. Swap in your own resolver/model names.

## Placement rule

| Test hits the DB? | Location | Discovered how | Order |
| --- | --- | --- | --- |
| **No** (pure / mocked) | `tests/__tests__/` (mirror the resolver's source path) | jest `testMatch` picks up **every `.js`** under `__tests__/` | none (independent) |
| **Yes** (real transaction) | `tests/_orders/<Category>/mutations/<Resolver>.js` | imported by the category's `_.test.js` | **guaranteed** within the category |

- **Why the split:** `__tests__` tests are independent and run in any order, so jest matches each
  file directly. `_orders` tests run against the **seeded DB** and mutate shared rows — their outcome
  depends on running in a fixed sequence. So jest matches **only** each category's `_.test.js`, and
  that file `import`s the write tests in order. The individual write files are named `<Resolver>.js`
  (not `*.test.js`) so jest does **not** pick them up on their own — they run only when `_.test.js`
  imports them.

## What goes in `tests/__tests__/` (no writes)

Mirror the resolver's source location under `tests/__tests__/`, then test the members that need no
DB — using `.create()` and `jest.spyOn` to substitute collaborators:

```
server/graphql/resolvers/user/actual/mutations/CreateArticleMutationResolver.js
  ↔ tests/__tests__/server/graphql/resolvers/user/mutations/CreateArticleMutationResolver.js
```

Cover here:

- **`.get:schema`** and **`.get:errorCodeHash`** — static getters (single `test()` is fine; static
  getters are the exception to `test.each` in the project's jest rules).
- **`#createInputValidator()` / `#validateInput()`** — assert they build/run the validator, with the
  validator **mocked** (`jest.spyOn(resolver, 'createInputValidator').mockReturnValue(...)`); never
  reach the real DB.
- **`#formatResponse()`** — pure shaping; feed an entity, assert the returned ids.
- **the factory / creators** (§7 DI) — `static create()` defaults and `static createXxx()` seams.

```js
import CreateArticleMutationResolver from '../../../../../../../server/graphql/resolvers/user/actual/mutations/CreateArticleMutationResolver.js'

describe('CreateArticleMutationResolver', () => {
  describe('.get:schema', () => {
    test('returns the schema name', () => {
      expect(CreateArticleMutationResolver.schema)
        .toBe('createArticle')
    })
  })
})
```

## What goes in `tests/_orders/` (writes)

The members that actually persist — **`#generateTransactionCallback()`** (run through
`Model.beginTransaction(callback)`) and **`#resolve()`** (the full flow) — go under the category of
the **model the resolver writes to**:

```
tests/_orders/<Category>/mutations/<Resolver>.js
```

- **`<Category>` is the primary written model's name**, not the operation's. `CreateArticle` /
  `UpdateArticle` → `tests/_orders/Article/mutations/`. When the operation writes a different model
  than its name suggests (e.g. a `publishArticle` that writes an `ArticleStatus` row), the category
  follows the **written** model — `tests/_orders/ArticleStatus/mutations/`.
- The file drives the real transaction against the seeded DB:

```js
import Article from '../../../../sequelize/models/Article.js'

import CreateArticleMutationResolver from '../../../../server/graphql/resolvers/user/actual/mutations/CreateArticleMutationResolver.js'

describe('CreateArticleMutationResolver', () => {
  describe('#generateTransactionCallback()', () => {
    // ... cases with unique, explicit-fake seed values ...
    test.each(cases)('...', async ({
      params,
      expected,
    }) => {
      const resolver = CreateArticleMutationResolver.create()

      const callback = resolver.generateTransactionCallback(params)

      // real write
      const actual = await Article.beginTransaction(callback)

      expect(actual)
        .toEqual(expected)
    })
  })
})
```

Cover here the write-path behavior: a valid input **creates/updates** the expected row; a missing
row throws the `204.*` `XxxNotFound`; an ownership violation throws `NotAllowedToXxx`; a no-op input
throws `CurrentXxxIsSameAsTheNewOne`. Use `describe` (not `if`) to separate the success and failure
branches — per the project's jest rules.

## The category `_.test.js` (ordering entry point)

Each `tests/_orders/<Category>/` holds one `_.test.js` — the only file jest matches in the category.
It `import`s the category's write tests in the intended run order:

```js
// tests/_orders/Article/_.test.js
import './mutations/CreateArticleMutationResolver.js'
import './mutations/UpdateArticleMutationResolver.js'
import './mutations/DeleteArticleMutationResolver.js'
```

When you add a new write test, create the `<Resolver>.js` file under the category's `mutations/` and
**add one `import` line to that category's `_.test.js`** in the correct position. Without the import
line the test never runs.

## Everything else → the project's jest rules

Data conventions (all fields unique, explicit-fake values — `title: 'string'` is weak; prefer
distinct values), `describe`/`test.each` structure, the AAA layout, and `jest.spyOn` mocking are the
same as any class test. Follow the project's jest rules; this page only adds
the **placement** rule specific to resolvers.
