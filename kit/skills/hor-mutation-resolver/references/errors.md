# errorCodeHash, error codes, and throwing

Every error a mutation resolver can raise is declared once in `static get errorCodeHash ()`. The
base turns that hash into constructable error classes on `this.errorHash`, and the resolver throws
them by name.

## Declaring the hash

Spread `...super.errorCodeHash` first (so framework-level codes stay), then add this resolver's
errors grouped by category with a blank line and a comment between groups:

```js
/** @override */
static get errorCodeHash () {
  return {
    ...super.errorCodeHash,

    // Invalid Input Errors
    InvalidEmail: '203.M024.001',
    InvalidPassword: '203.M024.002',

    // Database Errors
    UserNotFound: '204.M024.001',

    // Access Right Errors
    InvalidCredentials: '202.M024.001',
  }
}
```

## Which category an error falls into

The code string itself is settled by `hoc-error-codes` — its three parts, the categories the
leading one sorts a failure into, and the rule that a code already in use is never renumbered.
What a mutation resolver decides is which category each of its own errors belongs to, and where
that error is thrown from.

- **`203`, validational.** Names are `InvalidXxx` and correspond 1:1 to the validator's predicates
  (`InvalidTitle` ↔ `isValidTitle`), per the project's resolver-validator conventions.
- **`204`, database record.** `XxxNotFound`, `NotAllowedToXxx`, `CurrentXxxIsSameAsTheNewOne`.
  Thrown from inside the transaction callback ([transaction.md](./transaction.md)).
- **`202`, access right.** A credential that does not match, a principal barred from what it asked
  for — `InvalidCredentials` and the like.

- **Name = the reason, not the field alone.** `InvalidPublishedAt`, `TagNotFound`,
  `NotAllowedToEditArticle` — read as a sentence at the throw site. No `info`/`data`/`error`
  suffixes.

## Throwing

The base's factory runs `buildErrorHash({ errorCodeHash })`, which maps each `{ Name: code }` to a
`RenchanGraphqlError` subclass and stores them on `this.errorHash` (also reachable as `this.Error`).
Construct and throw with `.create()`:

```js
throw this.errorHash.ArticleNotFound.create()
```

- **Input errors** are returned by the validator and re-thrown at the top of `resolve()`
  (`if (validationError) throw validationError`).
- **State/auth errors** are thrown **inside the transaction callback** so the transaction rolls
  back (`throw this.errorHash.UserNotFound.create()`).
- Both categories surface to the client as GraphQL errors carrying the declared code.

## How the base wires it (for reference)

You do not write this — it comes from `BaseResolver` — but knowing it explains why the hash is all
you declare:

```js
// BaseResolver.create() → buildErrorHash() builds the classes from your codes
static create ({
  errorCodeHash = this.errorCodeHash,
} = {}) {
  const errorHash = this.buildErrorHash({
    errorCodeHash,
  })

  return new this({
    errorHash,
  })
}

// buildErrorHash: { Name: code } → { Name: RenchanGraphqlError subclass }
static buildErrorHash ({
  errorCodeHash = this.errorCodeHash,
} = {}) {
  return Object.fromEntries(
    Object.entries(errorCodeHash)
      .map(([errorName, code]) => [
        errorName,
        RenchanGraphqlError.declareGraphqlError({
          code,
        }),
      ])
  )
}
```

So: declare `{ Name: 'code' }` in `errorCodeHash`, and throw `this.errorHash.Name.create()`. When a
resolver injects dependencies via its own `static create()`, it must still call
`this.buildErrorHash({ errorCodeHash })` and pass the result as `errorHash` to the constructor —
see [dependency-injection.md](./dependency-injection.md).

## Optional: a local ErrorHash typedef

For editor help you may add a `@typedef` naming the errors the resolver throws, and annotate the
throw site. It documents the contract but is optional:

```js
/**
 * @typedef {{
 *   ArticleNotFound: RenchanGraphqlErrorCtor
 *   NotAllowedToEditArticle: RenchanGraphqlErrorCtor
 * }} ErrorHash
 */
```
