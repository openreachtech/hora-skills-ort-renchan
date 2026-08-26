# Payload (the input definition, where differences are confined)

How to write a payload that extends `BasePayload`. **Every interface difference from the external API
— method, path, query and body key names, value formats, authentication — is confined here**
([SKILL.md](../SKILL.md#first-principle-confine-every-difference-from-the-external-api-to-payload--capsule-anti-corruption-layer)).
Authentication is in [authorization.md](./authorization.md); the output side is in
[capsule.md](./capsule.md).

## Required overrides: `method` / `pathname` (plus `contentType` when there is a body)

- `static get method ()`: the HTTP method. Return **a value of `REST_METHOD`** such as
  `REST_METHOD.GET` — never a hard-coded string.
- `static get pathname ()`: the endpoint path. Write **the variable parts as `[placeholder]`**
  (e.g. `/v1/projects/[projectId]/documents`). The name inside `[]` corresponds to a key of the
  `pathParameterHash` passed to `create()`.
- `static get contentType ()`: needed only for methods that carry a body (`POST` / `PUT` / `PATCH`),
  e.g. `'application/json'`. It is not called for methods without a body, so it can stay undefined.
- **Why `[placeholder]`**: declaring the variable parts lets `RequestPathParameterHash` interpolate
  the values, and a missing key makes `hasInvalidParameterHash()` return `true` so the request becomes
  **an error `Capsule` before it is sent**. Assembling the path by string concatenation defeats that
  validation and an invalid URL goes out as-is.

```js
// Good: variable parts as [placeholder], method from REST_METHOD
/** @override */
static get method () {
  return REST_METHOD.GET
}

/** @override */
static get pathname () {
  return '/v1/projects/[projectId]/documents'
}
```

```js
// Bad: assembling the path by string concatenation (no missing-key validation, differences not confined)
static get pathname () {
  return `/v1/projects/${this.projectId}/documents` // NG
}
```

## Declare in `querySchema` / `bodySchema` only the keys that need conversion or validation

Declare the query and body schemas with the scalars from `@openreachtech/mentsu-schema` (`TextScalar` /
`KeywordScalar` / `IntegerScalar` / `DatetimeScalar`, …).

- A declared key becomes subject to **value normalization and validation** — `DatetimeScalar`, for
  instance, converts to an ISO string on the way out.
- The default is `{}`. **Keys absent from the schema are still sent**, so declare only the keys that
  need conversion or validation; the minimum is a fine place to start.
- **Why the minimum is enough**: the point of the schema is to shape values to the external API's spec
  before sending. Declaring keys that need no conversion (a plain string, say) achieves nothing, and a
  declaration that drifts from the actual spec is easy to misread. Declare what needs converting.

```js
import {
  KeywordScalar,
  IntegerScalar,
} from '@openreachtech/mentsu-schema'

export default class FindDocumentsPayload extends BasePayload {
  /** @type {Record<string, *>} */
  static querySchema = {
    keyword: KeywordScalar,
    limit: IntegerScalar,
  }

  // method / pathname / authentication ...
}
```

## When the outgoing keys are snake_case, swap in the Snake conversion classes

Write camelCase internally, and when the external API demands snake_case, absorb the difference by
returning a key-conversion class.

- `static get RequestQueryCtor ()`: returning `SnakeCasedKeyRequestQuery` makes the query keys
  snake_case.
- `static get RequestBodyCtor ()`: returning `SnakeCasedKeyRequestBody` makes the body keys snake_case.
- **Why convert here**: confining the difference between our naming convention (camelCase) and the
  external API's (snake_case) to the payload is the whole point of this module. The caller always
  writes camelCase (`bodyText`) and it becomes `body_text` on the way out. If the caller has to think
  about snake_case, the difference has leaked.

```js
import {
  TextScalar,
} from '@openreachtech/mentsu-schema'

import {
  BasePayload,
  SnakeCasedKeyRequestBody,
  REST_METHOD,
} from '@openreachtech/mentsu-rocket-client'

export default class CreateDocumentPayload extends BasePayload {
  /** @type {Record<string, *>} */
  static bodySchema = {
    title: TextScalar,
    bodyText: TextScalar, // SnakeCasedKeyRequestBody converts this to body_text on the way out
  }

  /** @override */
  static get method () {
    return REST_METHOD.POST
  }

  /** @override */
  static get contentType () {
    return 'application/json'
  }

  /** @override */
  static get pathname () {
    return '/v1/projects/[projectId]/documents'
  }

  /**
   * get: RequestBody constructor (camelCase -> snake_case).
   *
   * @override
   * @returns {typeof SnakeCasedKeyRequestBody}
   */
  static get RequestBodyCtor () {
    return SnakeCasedKeyRequestBody
  }

  // For authentication (AuthorizationBuilderCtor / authorizationApiKey) see authorization.md
}
```

## Inject fixed and default values with the `enrichXxx()` hooks

An API version that is always attached, a default `limit` and the like are injected with
`static enrichPathParameterHash ()` / `static enrichBody ()` / `static enrichQuery ()`.

- **Why**: so the caller is not forced to pass the same value every time. Injecting a fixed value is
  the payload's responsibility too, and stays confined there.

## Define the input types with `@typedef`

Declare the shape of `pathParameterHash` / `query` / `body` with `@typedef`, so the caller can assemble
them with the right keys.

```js
/**
 * @typedef {{
 *   projectId: string
 * }} FindDocumentsPathParameterHash
 */

/**
 * @typedef {{
 *   keyword?: string
 *   limit?: number
 * }} FindDocumentsQuery
 */
```

## Build one with `Payload.create()`, or with `createPayload()` through the launcher

```js
const payload = CreateDocumentPayload.create({
  pathParameterHash: {
    projectId: 'fake-project-id-001',
  },
  body: {
    title: 'fake-title-001',
    bodyText: 'fake-body-001',
  },
})
```

- When you already hold the launcher, use `Launcher.createPayload({ ... })` — the shortcut for
  `this.Payload.create(...)` ([usage.md](./usage.md)).
