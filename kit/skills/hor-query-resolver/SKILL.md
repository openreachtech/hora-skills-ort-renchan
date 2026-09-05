---
name: hor-query-resolver
description: >
  Write GraphQL Query resolvers under
  server/graphql/resolvers/<endpoint>/{actual,stub}/queries/<Operation>QueryResolver.js, extending
  BaseQueryResolver from @openreachtech/renchan. Use this skill whenever the user asks to add or
  edit a read query resolver, including its pagination, association includes, domain-error
  throwing, and the actual-vs-stub pair. Input validation belongs to the resolver input-validator
  convention; state-changing operations belong to the mutation resolver convention.
---

# Query Resolver

A skill for writing the **`*QueryResolver` classes** that answer a GraphQL `Query` field. A query
resolver **extends `BaseQueryResolver`** (from `@openreachtech/renchan`), is **read-only** (it never
opens a transaction — that is the mutation side's job), and always follows the same shape: a `schema`
getter that names the GraphQL field, an `errorCodeHash`, and a `resolve()` that **validates the
input, reads data, throws domain errors, and formats the response**.

> Examples use a made-up `users` domain (a `User` model with a `UserProfile` / `Department` / `Role`
> around it) on the `admin` endpoint. They are placeholders — swap in the resource, fields, and
> endpoint of the query you are writing.

This skill covers the **resolver class itself**. Two related skills own the pieces it delegates to:

- The `*InputValidator` it calls belongs to `hor-resolver-validator` —
  this skill only shows the wiring, not the validator internals.
- The unit tests belong to `hoc-jest` — see [testing.md](./references/testing.md) for
  the resolver-specific shape.

> This is the **Query** side. A **Mutation** resolver is a different template (it wraps a
> transaction callback and returns save results); do not copy this skeleton for a write.

## Core principle: a query resolver is a filled-in template

Every query resolver has the **same skeleton** — `schema` getter → `errorCodeHash` → `resolve()` →
validation wiring → finders → `formatResponse()` → error creators → a trailing block of `@typedef`s.
Keep the skeleton identical so review attention goes straight to the **query-specific differences
(what it reads and how it shapes the result)**. Do not write it cleverly; lean toward the layout of
the existing resolvers.

`resolve()` reads as a fixed pipeline:

1. **Validate** the input (`validateInput()` returns an error **or `null`**; `throw` it when present).
2. **Read** the data (finders: `findX()` / `countX()`), passing already-trusted input.
3. **Throw domain errors** for not-found / empty results, via `this.errorHash.Xxx.create()`.
4. **Format** the result to the GraphQL schema shape (`formatResponse()`), and `return` it.

```js
/** @override */
async resolve ({
  variables: {
    input,
  },
}) {
  const validationError = this.validateInput({
    input,
  })

  if (validationError) {
    throw validationError
  }

  const user = await this.findUser({
    userId: input.userId,
  })

  if (!user) {
    throw this.errorHash.UserNotFound.create()
  }

  return this.formatResponse({
    user,
  })
}
```

- **No transaction.** Queries only read. Reach for `.findOne` / `.findByPk` / `.findAll` / `.count`;
  never `db.transaction(...)` here.
- **`resolve()` orchestrates; the small methods do the work.** Each `findX` / `buildWhereClause` /
  `formatResponse` has one job and is unit-testable in isolation. Do not inline a 60-line find or a
  giant response object into `resolve()`.
- The full member-by-member template with JSDoc and the typedef block is in
  [anatomy.md](./references/anatomy.md).

## 1. Directory, class name, and schema linkage

One resolver = one file. Placement encodes the endpoint and whether it is real or a stub:

```
server/graphql/resolvers/<endpoint>/<actual|stub>/queries/<Operation>QueryResolver.js
```

- `<endpoint>` is the GraphQL endpoint the resolver serves: `user`, `customer`, `admin`, `portal`,
  `jobs`. It maps to a `*GraphqlServerEngine` (e.g. `server/graphql/AdminGraphqlServerEngine.js`).
- `<actual|stub>` — **`actual`** holds the real business logic; **`stub`** returns fixed fake data
  for the frontend to develop against ([errors-and-context.md](./references/errors-and-context.md)).
- Class name = `<Operation>QueryResolver` (PascalCase), default-exported, one class per file.
- **Auto-loaded — no manual registration.** The engine loads every file under `.../queries/` by
  directory (`actualResolversPath` in the engine config). Adding the file is enough; there is no
  index to edit.
- **`schema` getter = the GraphQL `Query` field name** (camelCase). It must match a field declared in
  `server/graphql/schemas/<endpoint>/*.graphql`, whose `Input!` / `Result!` types become the
  resolver's `input` and return shape:

  ```graphql
  # server/graphql/schemas/admin/003-user.graphql
  type Query {
    users(input: UsersInput!): UsersResult!
  }
  ```

  ```js
  /** @override */
  static get schema () {
    return 'users'
  }
  ```

## 2. Member order

Declare members in this fixed order (matches the existing resolvers and the backend guideline):

1. `static get schema ()` — the GraphQL field name. `@override`.
2. `static get errorCodeHash ()` — spread `...super.errorCodeHash`, then this resolver's codes (§4).
3. `async resolve ({ variables, context })` — the entrypoint. `@override`.
4. `validateInput ({ input })` — runs the validator, returns the error or `null`.
5. `createInputValidator ({ input, errorHash })` — factory for the `*InputValidator`.
6. **Finders and helpers**, in call order (`findX` / `countX` / `buildWhereClause` / `create*`).
   Place each helper right after its caller; unrelated helpers go in dictionary order.
7. `formatResponse ({ ... })` — shape the GraphQL result.
8. Error creators (`createXxxNotFoundError`), when domain errors are built through helpers.

After the class, a block of `@typedef`s (`ErrorCodeHash`, the `Input` / `Result` aliases, `ErrorHash`,
`RenchanGraphqlErrorCtor`, and any associated-entity types). See [anatomy.md](./references/anatomy.md).

## 3. Reading data

Finders are thin wrappers over the Sequelize models; keep query-shape logic (where clauses,
includes, pagination) in their own small methods so `resolve()` stays a pipeline.

- **Single record:** `Model.findByPk(id, { include })` / `Model.findOne({ where, include })`, then a
  not-found guard that throws a domain error.
- **List with pagination:** the canonical trio is `buildWhereClause()` → `countX({ whereClause })`
  (for `totalRecords`) → `findX({ whereClause, pagination })` (with `offset` / `limit` / `order`).
- **Associations:** pass an `include` tree of models; deep values are pulled out in `formatResponse`
  with `FieldPathValueExtractor`.

The where-clause / pagination / include / extractor patterns are in
[data-access.md](./references/data-access.md).

## 4. errorCodeHash and domain errors

`errorCodeHash` maps each error name to a **string code**; `.create()` turns those into the
`this.errorHash.<Name>` constructors the resolver throws. Spread the parent first:

```js
/** @override */
static get errorCodeHash () {
  return {
    ...super.errorCodeHash,

    // Invalid Input Errors (203 prefix)
    InvalidUserId: '203.Q002.001',

    // Database Errors (204 prefix)
    UserNotFound: '204.Q002.001',
  }
}
```

- **Leading number = error family.** `203` invalid input, `204` database / not-found, `205` business
  logic / external API. (Framework standards live above these: `102` unauthorized, `104` database —
  do not redefine them.)
- **Middle segment (`Q002`) is a stable per-query identifier**; the trailing `001…` numbers the
  errors within this resolver. Keep a given resolver on one identifier and add sequentially.
- **Input-shape errors** (`InvalidXxx`) are raised by the validator via the shared `errorHash`, so
  their names must exist here. **Domain errors** (`XxxNotFound`, `NoXxxFound`) are thrown from
  `resolve()` with `this.errorHash.Xxx.create()` (optionally through a `createXxxError()` helper).

The families, the validator↔errorHash contract, and error-creator helpers are in
[errors-and-context.md](./references/errors-and-context.md).

## 5. Input validation wiring

The resolver does not validate inline — it delegates to a `*InputValidator`
(`hor-resolver-validator`) through two small methods:

```js
validateInput ({
  input,
}) {
  const validator = this.createInputValidator({
    input,
  })

  return validator.validateInput()
}

createInputValidator ({
  input,
  errorHash = this.errorHash,
}) {
  return UsersInputValidator.create({
    input,
    errorHash,
  })
}
```

- `validateInput()` returns the error **or `null`**; `resolve()` throws it when present (do not throw
  from inside `validateInput`). The validator is fed the resolver's own `errorHash`, so its
  `InvalidXxx` names resolve to the codes declared in §4.
- A resolver that takes no input (or only auth from `context`) has **no** validator — see the
  minimal `departments` / `userSummary` resolvers in [anatomy.md](./references/anatomy.md).

## 6. Formatting the response

`formatResponse()` is the **only** place that builds the GraphQL output object. It maps model
entities to the schema's field names — never returns raw model instances.

- Rename model columns to schema fields (`user.id` → `userId`), map arrays to their output shape, and
  **echo pagination** (`limit` / `offset` / `sort` / `totalRecords`) for lists.
- Read deep association values with `FieldPathValueExtractor`; guard optional relations and default
  missing scalars (`?? ''` / `?? null`) rather than leaking `undefined`
  ([data-access.md](./references/data-access.md)).

## 7. Testing

Each public member is unit-tested with the `hoc-jest` skill: a top-level `describe` per
member, `test.each` cases, and `Resolver.create()` with no args. `#resolve()` gets both the
happy path and a throws-case per error code; `.get:schema` asserts the field name. The
resolver-specific structure (mocking the validator, DB-backed finder cases, `formatResponse` with
built model instances) is in [testing.md](./references/testing.md).

## Detail files

- [anatomy.md](./references/anatomy.md) — the full canonical resolver (every member with JSDoc, the
  minimal no-input variant, and the trailing `@typedef` block) (§2)
- [data-access.md](./references/data-access.md) — finders, `buildWhereClause`, the count+findAll
  pagination trio, association `include` trees, model `subquery()`, and `FieldPathValueExtractor` (§3, §6)
- [errors-and-context.md](./references/errors-and-context.md) — the errorCodeHash prefix families, the
  validator↔errorHash contract, domain-error creators, reading auth/providers off `context`, and
  actual-vs-stub resolvers (§1, §4)
- [testing.md](./references/testing.md) — the member-by-member test layout for a query resolver,
  building on the jest skill (§7)
