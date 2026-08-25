# Testing a query resolver

The member-by-member test layout for a `*QueryResolver`, building on the `hc-jest`
skill. Referenced from §7 of [SKILL.md](../SKILL.md). This file only covers what is
resolver-specific; describe/test structure, `cases` data rules, AAA, and naming come from the jest
skill.

> The `Users` / `User` names, the `203.Q001.*` codes, and the `users` schema below are placeholders —
> swap in your resolver's own names and codes.

## File location and construction

- The test mirrors the resolver path under `tests/__tests__/` but **without the `actual/` segment**:
  `server/graphql/resolvers/admin/actual/queries/UsersQueryResolver.js`
  → `tests/__tests__/server/graphql/resolvers/admin/queries/UsersQueryResolver.js`.
- A DB-backed resolver test reads the seeded database (`npm test` seeds `dev-master` + `development`),
  so finder cases assert against known seed rows.
- Build the resolver with the framework factory, **no args**: `const resolver = Resolver.create()`.
  `create()` injects `errorHash` from `errorCodeHash` for you.

## One top-level describe per member

Per the jest skill, give **each** public member its own top-level `describe('<Resolver>')` →
`describe('#member()')`. A query resolver typically tests: `#resolve()`, `#validateInput()`,
`#createInputValidator()`, the finders (`#buildWhereClause()`, `#countX()`, `#findX()`),
`#formatResponse()`, and `.get:schema`.

## `#resolve()`: happy path + a throws-case per error code

Split valid and error runs into sub-`describe`s. The happy path asserts the whole formatted result;
the error path asserts the **error code** for each way the query can fail.

```js
describe('UsersQueryResolver', () => {
  describe('#resolve()', () => {
    describe('when input is valid', () => {
      const cases = [
        {
          params: {
            variables: {
              input: {
                keyword: null,
                departmentId: null,
                pagination: {
                  limit: 10,
                  offset: 0,
                  sort: {
                    targetColumn: 'name',
                    orderBy: 'ASC',
                  },
                },
              },
            },
          },
          expected: {
            users: [
              // ... rows from the seed, fully spelled out ...
            ],
            pagination: {
              limit: 10,
              offset: 0,
              sort: {
                targetColumn: 'name',
                orderBy: 'ASC',
              },
              totalRecords: 11,
            },
          },
        },
      ]

      test.each(cases)('keyword: $params.variables.input.keyword', async ({
        params,
        expected,
      }) => {
        const resolver = UsersQueryResolver.create()

        const actual = await resolver.resolve(params)

        expect(actual)
          .toEqual(expected)
      })
    })

    describe('should throw error', () => {
      const cases = [
        {
          params: {
            variables: {
              input: {
                keyword: /** @type {*} */ (1),
                pagination: {
                  limit: 1,
                  offset: 0,
                },
              },
            },
          },
          errorCode: '203.Q001.001',
        },
        {
          params: {
            variables: {
              input: {
                keyword: null,
                pagination: {
                  limit: -1,
                  offset: 0,
                },
              },
            },
          },
          errorCode: '203.Q001.003',
        },
      ]

      test.each(cases)('limit: $params.variables.input.pagination.limit', async ({
        params,
        errorCode,
      }) => {
        const resolver = UsersQueryResolver.create()

        const actual = resolver.resolve(params)

        await expect(actual)
          .rejects
          .toThrow(errorCode)
      })
    })
  })
})
```

- Assert the **thrown error by its code string** with `.rejects.toThrow('203.Q001.003')`. Cover at
  least one case per `InvalidXxx` (via bad input) and per domain error (`XxxNotFound`, by asking for a
  missing id).
- Cast deliberately-wrong input to `/** @type {*} */ (...)` so the type checker allows the invalid
  case.

## `#validateInput()` and `#createInputValidator()`

Test the wiring, not the validator's internals (those belong to
`hb-resolver-validator`'s own test).

- **`#validateInput()`** — `jest.spyOn(resolver, 'createInputValidator')` to return a mock validator
  whose `validateInput()` is stubbed; assert `#validateInput()` returns exactly what the validator
  returned (an error or `null`) and that the mock was called.
- **`#createInputValidator()`** — assert the returned instance `toBeInstanceOf` the expected
  `*InputValidator` and that its `errorHash` is the resolver's `errorHash` (`toBe(resolver.errorHash)`).

## Finders and `#formatResponse()`

- **Finders** (`#countX`, `#findX`, `#buildWhereClause`) are tested directly against the seed. For
  `buildWhereClause`, assert the returned Sequelize `where` object with `toEqual` — including `Op`
  symbol keys and any `Model.subquery(...)` expression, which you reproduce in `expected`.
- **`#formatResponse()`** is pure and DB-free: **build** model instances with `Model.build({...})` for
  the input entities, call `formatResponse`, and `toEqual` the exact GraphQL shape (renamed fields,
  defaulted scalars, echoed pagination).

```js
describe('UsersQueryResolver', () => {
  describe('#formatResponse()', () => {
    /** @type {Array<*>} */
    const cases = [
      {
        params: {
          users: [
            User.build({
              id: 1,
              name: 'Alpha',
              email: 'alpha@example.com',
              isActive: true,
            }),
          ],
          pagination: {
            limit: 10,
            offset: 0,
          },
          totalRecords: 1,
        },
        expected: {
          users: [
            {
              userId: 1,
              name: 'Alpha',
              email: 'alpha@example.com',
              isActive: true,
            },
          ],
          pagination: {
            limit: 10,
            offset: 0,
            sort: null,
            totalRecords: 1,
          },
        },
      },
    ]

    test.each(cases)('totalRecords: $params.totalRecords', ({
      params,
      expected,
    }) => {
      const resolver = UsersQueryResolver.create()

      const actual = resolver.formatResponse(params)

      expect(actual)
        .toEqual(expected)
    })
  })
})
```

## `.get:schema`

The static getter is a single-value contract — a plain `test` (no `test.each`) is fine here, per the
jest skill's exception for argument-less static getters:

```js
describe('UsersQueryResolver', () => {
  describe('.get:schema', () => {
    test('should return correct schema name', () => {
      const actual = UsersQueryResolver.schema

      expect(actual)
        .toBe('users')
    })
  })
})
```

## Reminders from the jest skill

- **Unique, explicitly-fake data** across every field and row; comments in the test `.js` in English.
- **Do not shrink coverage using implementation knowledge** — test each member's contract as a black
  box, including `formatResponse`'s field renames and defaulting (feed values that make the transform
  visible, not no-op values).
- For a resolver that reads `context`, pass a **stub context** in `params` shaped like the real
  principal (`{ context: { employee: { EmployeeRoleAssignments: [...] } } }`); see
  [errors-and-context.md](./errors-and-context.md).
