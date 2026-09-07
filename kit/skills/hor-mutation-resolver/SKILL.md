---
name: hor-mutation-resolver
description: >
  Implement GraphQL Mutation resolvers under
  server/graphql/resolvers/<endpoint>/actual/mutations/<Operation>MutationResolver.js, extending
  BaseMutationResolver (@openreachtech/renchan). Use this skill whenever the user asks to write or
  edit a mutation resolver — a create / update / delete / sign-in / upload operation that changes
  state, and the single transaction it runs in. Input validation, heavy background work and read
  operations each belong to their own convention.
---

# Mutation Resolver

A skill for writing the **`*MutationResolver` classes** that resolve a GraphQL `Mutation` — the
synchronous write path of the API. A resolver **extends `BaseMutationResolver`** (from
`@openreachtech/renchan`), declares which schema it resolves and which error codes it can raise, and
runs a **fixed four-step flow** in `resolve()`. The value-shape checks live in a separate
`*InputValidator`; the heavy/slow work lives in a Worker. The resolver
itself only **orchestrates**.

> Directory layout follows the target convention (same idealized layer as the
> `*InputValidator`). `BaseMutationResolver` /
> `BaseResolver` come from the renchan framework; the `*InputValidator` comes from the shared
> validator layer; the models come from `sequelize/models/`.

## Core principle: a mutation resolver is a filled-in template

Every mutation resolver has the **same skeleton** — the same method set in the same order, and the
same `resolve()` flow:

```
resolve() ─┬─▶ validateInput()               → throw the InvalidXxx error, or continue
           ├─▶ generateTransactionCallback()  → a `async transaction => {...}` closure
           ├─▶ Model.beginTransaction(callback)→ run every find + save in ONE transaction
           └─▶ formatResponse()               → shape the result (usually just an id)
```

Keep the skeleton identical so review attention goes straight to the **operation-specific
difference (which models, which guards, which columns)**. Do not write it cleverly; lean toward the
shape of the existing resolvers. Three rules carry most of the weight:

1. **All finds and saves for one request go inside one transaction callback** — never split a
   `find` and its `save` across the transaction boundary (§4, [transaction.md](./references/transaction.md)).
2. **The resolver validates then delegates.** Input shape → the `*InputValidator` (§6). Value
   changes → the transaction callback. Heavy/slow work → a Worker (§8). The resolver holds no
   business rule that either of those should own.
3. **Return the save result, not a rendered view** (§5). A mutation returns ids; the frontend
   re-fetches with a Query. This keeps Mutation and Query responsibilities separate.

> The examples use generic entities (`Article`, `User`) and standard tools; substitute your own
> domain models. What transfers is the shape — one transaction, validate-then-delegate, return the
> save result — not the entity names.

- **Comments: English for code, the surrounding language for domain notes.** Comments written into
  the resolver `.js` are English. Domain/ticket notes may be Japanese where the surrounding files
  are — match the neighbors.

## 1. Directory, file name, and the `schema` getter

One resolver = one file (one class per file). Place it under the endpoint it belongs to:

- **Path:** `server/graphql/resolvers/<endpoint>/actual/mutations/<Operation>MutationResolver.js`
  - `<endpoint>` is the GraphQL endpoint (`user`, `customer`, `admin`, `portal`, …).
  - `actual` = real business logic; the sibling `stub/` holds fixed-data stubs for the same schema.
  - e.g. `server/graphql/resolvers/user/actual/mutations/CreateArticleMutationResolver.js`.
- **Class name** = `<Operation>MutationResolver` (PascalCase), where `<Operation>` is the schema in
  PascalCase (`createArticle` → `CreateArticleMutationResolver`).
- **`static get schema()`** returns the GraphQL schema name in camelCase and is marked `@override`.
  The base can derive it from the class name, but **always declare it explicitly** — it is the
  single, greppable link between the schema and the class.

```js
import {
  BaseMutationResolver,
} from '@openreachtech/renchan'

export default class UpdateArticleMutationResolver extends BaseMutationResolver {
  /** @override */
  static get schema () {
    return 'updateArticle'
  }

  // ... errorCodeHash, resolve(), helpers ...
}
```

## 2. The `resolve()` flow and method order

`resolve()` is the entry point and reads the same everywhere: **validate → build callback → run in
one transaction → format**. It receives `{ variables: { input }, context }`; `context` supplies
`now`, `userId` / `user`, and the endpoint identity.

```js
/**
 * @param {{
 *   variables: { input: server.graphql.user.UpdateArticleInput }
 *   context: UserGraphqlContext
 * }} params
 * @returns {Promise<server.graphql.user.UpdateArticleResult>}
 */
async resolve ({
  variables: {
    input,
  },
  context,
}) {
  const validationError = this.validateInput({
    input,
  })

  if (validationError) {
    throw validationError
  }

  const callback = this.generateTransactionCallback({
    input,
    context,
  })

  const article = await Article.beginTransaction(callback)

  return this.formatResponse({
    article,
  })
}
```

**Method order (matches the framework guideline):**

1. `static get schema ()` — `@override`
2. `static get errorCodeHash ()` — `@override` (§3)
3. *(optional)* `constructor` → `static create ()` → `static createXxx ()` factory helpers — only when
   a dependency must be injected (§7)
4. `async resolve ()` — the flow above
5. `createInputValidator ({ input })` (§6)
6. `validateInput ({ input })` (§6)
7. `generateTransactionCallback ({ input, context })` (§4)
8. other instance methods — `findXxx` / `buildXxxAttributes` / `updateXxx`, placed **next to their
   caller** (call-related methods adjacent; unrelated ones alphabetical)
9. `formatResponse ({ ... })` (§5)
10. `@typedef` blocks at the bottom (context type, entity types)

The full template with every helper filled in is in
[resolve-flow.md](./references/resolve-flow.md).

## 3. `errorCodeHash` and throwing errors

Declare every error the resolver can raise in `static get errorCodeHash ()`, spreading
`...super.errorCodeHash` first. Each entry maps an `ErrorName` to a **code string** whose leading
segment encodes the category:

- `203.*` — **invalid input** (`InvalidXxx`). These pair with the validator's predicates (§6).
- `204.*` — **DB / state** errors (`XxxNotFound`, `NotAllowedToXxx`, `CurrentXxxIsSameAsTheNewOne`).
- `205.*` — **auth** errors (`InvalidCredentials`).

```js
/** @override */
static get errorCodeHash () {
  return {
    ...super.errorCodeHash,

    // Invalid Input Errors
    InvalidArticleId: '203.M012.001',
    InvalidTitle: '203.M012.003',

    // Database Errors
    ArticleNotFound: '204.M012.002',
    CurrentArticleContentIsSameAsTheNewOne: '204.M012.003',
  }
}
```

The base turns this hash into constructable error classes on `this.errorHash` (via
`buildErrorHash()` in the factory). **Throw with `this.errorHash.<Name>.create()`** — validator
errors bubble out of `resolve()`; state errors are thrown from inside the transaction callback so
the transaction rolls back. Codes, numbering (`M###`), and the wiring are in
[errors.md](./references/errors.md).

## 4. `generateTransactionCallback()` — one transaction, all writes

`generateTransactionCallback({ input, context })` returns an **`async transaction => { ... }`**
closure that holds **every find and save for the request**. It is handed to
`Model.beginTransaction(callback)`, which opens a managed transaction and passes it in. Pass that
`transaction` to **every** query inside.

```js
generateTransactionCallback ({
  input: {
    title,
    content,
    articleId,
  },
  context: {
    now,
    userId,
  },
}) {
  return async transaction => {
    const article = await this.findArticle({
      articleId,
      transaction,
    })

    if (!article) {
      throw this.errorHash.ArticleNotFound.create()
    }

    article.set({
      title,
      content,
      LastModifiedByUserId: userId,
      lastModifiedAt: now,
    })

    return /** @type {*} */ (
      article.save({
        transaction,
      })
    )
  }
}
```

- **Why one transaction:** a `find` then `save` split across two transactions lets a concurrent
  request interleave (`find1 → find2 → save1 → save2`) and corrupt state. Keeping them in one
  callback serializes them.
- **`.set()` + `.save()`, never `.update()`** — the backup mixin needs the full row; `.update()`
  can drop fields. Create rows with `Model.create(attributes, { include, transaction })`.
- **State guards throw inside the callback** (`throw this.errorHash.XxxNotFound.create()`) so the
  transaction rolls back. Existence / ownership / no-op checks belong here, not in the validator.

Nested-create `include`, existence-count guards, associations, and post-transaction side effects
(work that must observe the committed result and runs **after** the commit) are in
[transaction.md](./references/transaction.md).

## 5. `formatResponse()` — return the save result, not a view

`formatResponse()` shapes the transaction's result into the GraphQL result type. **Return the
minimum that identifies what changed — usually just an id** (plus a timestamp for a delete).

```js
formatResponse ({
  article,
}) {
  return {
    articleId: article.id,
  }
}
```

- **Why minimal:** a Mutation's job is to report *that* the write happened. The frontend re-fetches
  the updated data with a **Query**. Returning a fully rendered object here duplicates the Query and
  couples the two. Keep Mutation and Query concerns separate. See
  [resolve-flow.md](./references/resolve-flow.md#formatresponse).

## 6. Input validation → the project's resolver-validator conventions

The resolver never inlines value checks. It builds a `*InputValidator` and runs it; the validator
returns an `InvalidXxx` error (or `null`).

```js
createInputValidator ({
  input,
}) {
  return UpdateArticleInputValidator.create({
    errorHash: this.errorHash,
    input,
  })
}

validateInput ({
  input,
}) {
  return this.createInputValidator({
    input,
  })
    .validateInput()
}
```

Write the `*InputValidator` itself following the project's resolver-validator conventions. Split of
duty: **shape/format → validator; existence/ownership/state → transaction callback (§4).**

## 7. Dependency injection — only when a dependency is needed

Simple resolvers need **no** constructor or factory: the base `create({ errorCodeHash })` builds the
error hash for you. Add a `constructor` + `static create ()` + `static createXxx ()` factory helpers
**only** when the resolver depends on a tool (token generator, encipher, random-text generator, …)
that tests must be able to substitute.

```js
constructor ({
  accessTokenGenerator,
  ...remainingParams
}) {
  super(remainingParams)

  this.accessTokenGenerator = accessTokenGenerator
}

static create ({
  accessTokenGenerator = this.createAccessTokenGenerator(),
  errorCodeHash = this.errorCodeHash,
} = {}) {
  const errorHash = this.buildErrorHash({
    errorCodeHash,
  })

  return new this({
    accessTokenGenerator,
    errorHash,
  })
}
```

- **Why inject:** hard-`new`-ing a token/crypto tool inside a method makes the resolver untestable
  and hides its collaborators. A default-valued factory keeps production calls a plain `.create()`
  while letting a test pass a fake. Full pattern in
  [dependency-injection.md](./references/dependency-injection.md).

## 8. Heavy or slow work → a Worker, not the resolver

A resolver responds **synchronously**; it must stay fast. If the operation is slow or uncertain
(external API, AI call, bulk records, file generation), the resolver should **enqueue a job and
return immediately** — the real work runs in a Worker. Decide following the project's
execution-placement-pattern conventions, and implement the Worker following the project's
renchan-job-bullmq conventions. When in doubt, push to the Worker.

## Testing

Test the resolver following the project's jest rules, split across **two locations by whether
the test writes to the DB**:

- **No writes → `tests/__tests__/`** (mirror the resolver's source path). Static getters
  (`schema`, `errorCodeHash`), `createInputValidator` / `validateInput` (validator **mocked** via
  `jest.spyOn`), `formatResponse` (pure), and the DI factory (§7). Jest auto-discovers every `.js`
  under `__tests__/`; these run independently, in any order, and hit no DB.
- **Writes → `tests/_orders/<Category>/mutations/<Resolver>.js`**. `generateTransactionCallback`
  (run through `Model.beginTransaction`) and `resolve` (full flow) against the seeded DB — assert a
  valid input persists the row, a missing row throws the `204.*` and rolls back, etc. `<Category>`
  is the **model the resolver writes to** (`CreateArticle` → `Article`). Ordering within a category
  is guaranteed by its `_.test.js`, which `import`s each write file in sequence — add an import line
  there when you add a test, or it never runs.

Everything else (unique fake data, `test.each`, `describe` branches, AAA, mocks) follows the
project-wide jest rules unchanged. Full placement detail in [testing.md](./references/testing.md).

## Detail files

- [resolve-flow.md](./references/resolve-flow.md) — the full resolver template (every method with
  JSDoc), method order, `createInputValidator`/`validateInput`, and `formatResponse` shapes (§2,§5,§6)
- [transaction.md](./references/transaction.md) — `generateTransactionCallback` in depth:
  one-transaction rule, `beginTransaction`, nested-create `include`, existence guards, `.set()`+
  `.save()` vs `.update()`, throwing state errors, post-commit side effects (§4)
- [errors.md](./references/errors.md) — `errorCodeHash` categories (203/204/205), `M###` numbering,
  `this.errorHash.<Name>.create()`, and how the base builds the error hash (§3)
- [dependency-injection.md](./references/dependency-injection.md) — `constructor` + `static create()`
  + `static createXxx()` factory helpers, when to inject, `buildErrorHash` wiring (§7)
- [testing.md](./references/testing.md) — the `tests/__tests__/` (no-write) vs `tests/_orders/`
  (write, ordered by `_.test.js`) placement split, what to test in each, and the category rule
