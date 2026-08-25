# Capsule (the response wrapper, extracting values)

How to write a capsule that extends `BaseCapsule`. It is what `launchRequest()` returns, and
**differences in response shape — key names, nesting, missing fields — are confined here**
([SKILL.md](../SKILL.md#first-principle-confine-every-difference-from-the-external-api-to-payload--capsule-anti-corruption-layer)).
The input side is in [payload.md](./payload.md). The capsule for the SDK-wrapping pattern is in
[sdk-wrapper.md](./sdk-wrapper.md).

## The main members `BaseCapsule` provides

| Member | Role |
| :-- | :-- |
| `get body` | The normalized response body (after `bodySchema` / `ResponseBodyCtor`). `null` when there is none |
| `get statusCode` | The HTTP status code. `null` when there is none |
| `hasError()` | `true` on any error: authentication, input, network, parse, or status (>= 400) |
| `getErrorMessage()` | The error-code string for the error kind. `null` when there is no error |
| `isPending()` | `true` before sending (when `payload` is `null`) |

- The caller **decides failure with `hasError()`** and writes no `try-catch`
  ([SKILL.md](../SKILL.md#decide-failure-with-capsulehaserror-not-try-catch)).

## When the response is snake_case, swap `ResponseBodyCtor` for the Camel one

Returning `CamelCasedKeyResponseBody` from `static get ResponseBodyCtor ()` converts incoming
snake_case keys into internal camelCase. `this.body` is then read with the converted keys.

- **Why**: even when the external API returns `document_id`, the application stays consistent with
  `documentId`. Confining the incoming naming difference to the capsule lets everything from
  `extractXxx()` onward be written in our own conventions only.

## `extractXxx()` always guards against null, and returns `null` / an empty array when the value is missing

Add one `extractXxx()` per value you want out of the response.

- `this.body` **can be `null`** (on a network or parse failure, for instance). **Always guard with
  optional chaining** or equivalent before returning a value.
- When the value cannot be produced, return **`null`** — or an **empty array** for something that
  returns an array — never `undefined`
  ([SKILL.md](../SKILL.md#return-null-or-an-empty-array-for-a-missing-value-never-undefined)).
- **Why the null guard is required**: forget it and an error `Capsule` (whose `body` is `null`) throws a
  `TypeError` at `this.body.documentId`, which breaks the design of deciding failure with
  `hasError()`. Extraction guarantees a safe default even when the request failed.
- **Why not `undefined`**: `undefined` cannot be told apart from "undefined behaviour / not implemented
  yet". `null` (or an empty array) states the intent to the caller: the value was looked for and was
  not there.

```js
import {
  BaseCapsule,
  CamelCasedKeyResponseBody,
} from '@openreachtech/mentsu-rocket-client'

/**
 * @extends {BaseCapsule<*, *>}
 */
export default class CreateDocumentCapsule extends BaseCapsule {
  /**
   * get: ResponseBody constructor (snake_case -> camelCase).
   *
   * @override
   * @returns {typeof CamelCasedKeyResponseBody}
   */
  static get ResponseBodyCtor () {
    return CamelCasedKeyResponseBody
  }

  /**
   * Extract created document ID.
   *
   * @returns {string | null}
   */
  extractDocumentId () {
    return this.body?.documentId
      ?? null
  }
}
```

```js
// Bad: no null guard, and it returns undefined
extractDocumentId () {
  return this.body.documentId // TypeError when body is null (breaks on an error Capsule)
}
```

Extracting an array — an empty array when missing, reshaped to our own keys:

```js
import {
  BaseCapsule,
  CamelCasedKeyResponseBody,
} from '@openreachtech/mentsu-rocket-client'

/**
 * @extends {BaseCapsule<*, *>}
 */
export default class FindDocumentsCapsule extends BaseCapsule {
  /** @override */
  static get ResponseBodyCtor () {
    return CamelCasedKeyResponseBody
  }

  /**
   * Extract documents.
   *
   * @returns {Array<{
   *   documentId: string
   *   title: string
   * }>}
   */
  extractDocuments () {
    return this.body?.documents
      ?.map(document => ({
        documentId: document.documentId,
        title: document.title,
      }))
      ?? []
  }
}
```

- The `map` **reshapes to only the keys the application needs**. Extra keys and nesting the external
  API returns are not passed to the caller unchanged — that is the confinement. Iterate with `map`,
  not `for` or `forEach` ([conventions.md](./conventions.md)).

## Normalize response values with `bodySchema` (optional)

Declaring `static bodySchema` makes the declared keys subject to value normalization (normalizing a
datetime string, say). Use it when you want the values shaped into something the application handles
more easily. `extractXxx()` works whether or not it is declared.
