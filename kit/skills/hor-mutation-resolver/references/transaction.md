# generateTransactionCallback — one transaction, all writes

`generateTransactionCallback({ input, context })` is where the resolver's real work lives. It
returns a single **`async transaction => { ... }`** closure that performs **every find and save for
the request**, and it is run by `Model.beginTransaction(callback)`. This file covers the rules that
keep that closure correct.

> Examples use a generic `Article` entity (with a `Tag` many-side and a nested `ArticleCategory`
> association). Swap in your own models — the rules are what transfer.

## The closure is built, then run

`generateTransactionCallback` returns the closure — it does not execute it. `resolve()` hands the
closure to `beginTransaction`, which opens a managed transaction, invokes the closure with the live
`transaction`, commits on success, and rolls back if the closure throws.

```js
const callback = this.generateTransactionCallback({
  input,
  context,
})

// opens the transaction, runs the callback, commits (or rolls back on throw)
const article = await Article.beginTransaction(callback)
```

- Destructure `input` and `context` **in the parameter list** of `generateTransactionCallback` so
  the closure body reads flat. Pull out exactly the fields the writes need (`now`, `userId`, and the
  input columns).
- The closure's return value is what `beginTransaction` resolves to and what `resolve()` passes to
  `formatResponse`.

## Rule 1 — every query takes the same `transaction`

Pass the `transaction` the closure received into **every** `findOne` / `findAll` / `create` /
`save` inside it. A query without it runs outside the transaction and defeats the point.

```js
return async transaction => {
  // every query takes the same `transaction`
  const article = await this.findArticle({
    articleId,
    transaction,
  })

  // ...

  return article.save({
    transaction,
  })
}
```

- **Why one transaction for the whole request:** a `find` and its dependent `save` split across two
  transactions let a concurrent request interleave — `find1 → find2 → save1 → save2` — and write
  duplicate or stale state. One transaction serializes the read-modify-write.

## Rule 2 — guard state inside the closure; throw to roll back

Existence, ownership, and no-op checks belong **here**, not in the validator (the validator only
knows input shape, not the DB). Throw the matching `204.*` error from `this.errorHash`; the throw
rolls the transaction back.

```js
return async transaction => {
  const article = await this.findArticle({
    articleId: input.articleId,
    transaction,
  })

  // 204.* — not found
  if (!article) {
    throw this.errorHash.ArticleNotFound.create()
  }

  // 204.* — ownership
  if (
    !this.isArticleAuthor({
      article,
      context,
    })
  ) {
    throw this.errorHash.NotAllowedToEditArticle.create()
  }

  // ... proceed with the writes ...
}
```

```js
isArticleAuthor ({
  article,
  context,
}) {
  return article.CreatedByUserId === context.userId
}
```

- **A "nothing changed" guard is legitimate**: if the new values equal the current ones, throw a
  `CurrentXxxIsSameAsTheNewOne` (`204.*`) rather than issuing a pointless write.
- Use early `if (...) throw` — no nested branches, no `else`. One guard per `if`.

## Rule 3 — `.set()` + `.save()` to update; `.create()` to insert; never `.update()`

The models use a backup mixin that snapshots the full row, so a partial `.update()` can lose
fields. Always load, mutate, and save the whole instance.

```js
// update: load → set → save
article.set({
  title,
  content,
  LastModifiedByUserId: userId,
  lastModifiedAt: now,
})

return article.save({
  transaction,
})
```

```js
// create: one call, with nested associations via `include`
return Article.create({
  title,
  content,
  CreatedByUserId: userId,
  LastModifiedByUserId: userId,
  lastModifiedAt: now,
  savedAt: now,
  isDeleted: false,

  // nested association row
  ArticleCategory: {
    CategoryId: categoryId,
  },
}, {
  // list the child model(s) for the nested create
  include: [
    ArticleCategory,
  ],
  transaction,
})
```

- **Nested create:** to insert an entity together with its associations in one statement, put the
  child object(s) under the association name and list the child model(s) in `include`.
- **FK columns start uppercase** (`CreatedByUserId`, `CategoryId`) — the association's naming
  convention, mirrored from the migration/model side.
- **Bulk existence guard:** when the input carries an id array, dedupe and count before writing —

```js
const uniqueTagIds = [...new Set(tagIds)]

const tags = await this.findTags({
  tagIds: uniqueTagIds,
  transaction,
})

if (tags.length !== uniqueTagIds.length) {
  throw this.errorHash.TagNotFound.create()
}
```

  Use `map` / `filter` / `Set`, not `Array#forEach` / `for`.

## Extracting attribute-building

When the create payload is large, build it in a separate `buildXxxAttributes({ ... })` method that
returns the plain object, and keep the closure to *find-guard-create*. Place `buildXxxAttributes`
next to the closure that calls it. This keeps the transaction closure readable and the attribute
shape unit-testable on its own.

## Side effects that must run after commit

Work that must observe the **committed** result — refreshing a denormalized read model, updating a
cache, notifying another system — runs in `resolve()` **after** `beginTransaction` returns, not
inside the closure. It reads the returned entity and does its own work.

```js
const article = await Article.beginTransaction(callback)

// after commit: propagate the persisted row to the read side
await this.refreshReadModel({
  article,
})

return this.formatResponse({
  article,
})
```

- **Why after, not inside:** the side effect should reflect data that actually committed; running it
  in the transaction would act on rows that a later rollback discards.
- **If the side effect is slow or unreliable** (large re-index, external call, bulk fan-out), do not
  run it inline at all — enqueue a Worker and return. Decide following the project's
  execution-placement-pattern conventions.
