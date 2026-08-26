# Dependency injection — constructor + factory helpers

Most mutation resolvers need **no** constructor and no `create()`: the base
`BaseResolver.create({ errorCodeHash })` builds the error hash and constructs the resolver for you.
Add the injection triple **only** when the resolver depends on a collaborator that tests must be
able to replace.

## When to inject

Inject when the resolver uses a **tool with side effects or nondeterminism** that a test cannot let
run for real:

- a random-text generator (`RandomTextGenerator`) — random ids / tokens,
- an encipher (`Encipher`) — password hashing / compare,
- a token generator (`AccessTokenGenerator`) — nondeterministic output,
- any external client.

Do **not** inject models or the validator — models are imported directly and used statically; the
validator is built inline in `createInputValidator` (a test stubs that method). If the resolver only
does validate → transaction → format with plain model calls, skip this file entirely.

## The triple: constructor, factory, per-dependency creators

The example: a `createArticle` resolver that needs a `RandomTextGenerator` to generate a public id.

```js
import {
  RandomTextGenerator,
} from '@openreachtech/renchan-tools'

import {
  BaseMutationResolver,
} from '@openreachtech/renchan'

export default class CreateArticleMutationResolver extends BaseMutationResolver {
  /** @override */
  static get schema () {
    return 'createArticle'
  }

  /**
   * @param {{
   *   randomTextGenerator: RandomTextGenerator
   *   errorHash: object
   * }} params
   */
  constructor ({
    randomTextGenerator,
    ...remainingParams
  }) {
    super(remainingParams)

    this.randomTextGenerator = randomTextGenerator
  }

  /**
   * Factory method.
   *
   * @param {{
   *   randomTextGenerator?: RandomTextGenerator
   *   errorCodeHash?: object
   * }} [params]
   * @returns {CreateArticleMutationResolver}
   */
  static create ({
    randomTextGenerator = this.createRandomTextGenerator(),
    errorCodeHash = this.errorCodeHash,
  } = {}) {
    const errorHash = this.buildErrorHash({
      errorCodeHash,
    })

    return new this({
      randomTextGenerator,
      errorHash,
    })
  }

  /**
   * @returns {RandomTextGenerator}
   */
  static createRandomTextGenerator () {
    return RandomTextGenerator.create()
  }

  /** @override */
  static get errorCodeHash () {
    return {
      ...super.errorCodeHash,
      // ...
    }
  }

  // resolve(), generateTransactionCallback(), etc.

  /**
   * @returns {string}
   */
  generateIdHash () {
    return this.randomTextGenerator.generate()
  }
}
```

The three parts, in order (right after `schema` / before `errorCodeHash` per the method order in the
[SKILL](../SKILL.md#2-the-resolve-flow-and-method-order)):

1. **`constructor ({ <deps>, ...remainingParams })`** — assign each dependency to `this`, and pass
   `remainingParams` (which carries `errorHash`) straight to `super()`. Never swallow `errorHash`.
2. **`static create ({ <dep> = this.create<Dep>(), errorCodeHash = this.errorCodeHash } = {})`** —
   each dependency **defaults to its creator**, so production calls stay a bare
   `SomeResolver.create()`. Build the error hash with `this.buildErrorHash({ errorCodeHash })` and
   pass it as `errorHash` (the base's own `create()` did this for you; once you override `create()`
   you must do it yourself).
3. **`static create<Dep> ()`** — one tiny creator per dependency returning the real instance
   (`return RandomTextGenerator.create()`). This is the single seam a test overrides.

## Why this shape

- **Testability.** A test calls `SomeResolver.create({ randomTextGenerator: fakeGenerator })` (or
  spies on `createRandomTextGenerator`) and asserts behavior deterministically. Hard-`new`-ing the
  tool inside a method would make that impossible.
- **Production stays trivial.** Because every dependency has a default, callers that don't care
  write `.create()` and get the real wiring — the injection is invisible until a test needs it.
- **`errorHash` still flows.** Overriding `create()` must not drop the base's error-hash build;
  `...remainingParams` + `buildErrorHash` keep the error mechanism ([errors.md](./errors.md))
  intact.

## Use the dependency inside methods via a thin wrapper

Reach the injected tool through a one-line instance method, not by scattering `this.<dep>.foo()`
across the class — it names the intent and gives tests one more seam:

```js
generateIdHash () {
  return this.randomTextGenerator.generate()
}

async verifyPassword ({
  originalPassword,
  passwordHash,
}) {
  return this.encipher.compare(
    originalPassword,
    passwordHash
  )
}
```
