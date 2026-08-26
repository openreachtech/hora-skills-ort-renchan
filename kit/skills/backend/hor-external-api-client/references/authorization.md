# Authorization

How the `Authorization` header is decided. Authentication is a difference on the way in, so it is
**confined to the `Payload`** ([payload.md](./payload.md)). Referenced from [SKILL.md](../SKILL.md).

The `Authorization` header is decided by the payload's `AuthorizationBuilderCtor` and
`authorizationApiKey` — or by the per-request `optionHash`.

## Pick the implementation by how the credential is held

| How the credential is held | Implementation |
| :-- | :-- |
| **A key shared across the service** (an API token in `env`, …) | Return `BearerAuthorizationBuilder` from `AuthorizationBuilderCtor` and `env.XXX` from `authorizationApiKey`. The header is generated for you |
| **A per-request token** (a user's access token, …) | Set `AuthorizationBuilderCtor`, leave `authorizationApiKey` as `null`, and pass `optionHash.headers.Authorization` when building the payload |
| **Basic authentication** | Return `BasicAuthorizationBuilder` from `AuthorizationBuilderCtor` and `'user:pass'` from `authorizationApiKey` (it is Base64-encoded for you) |
| **No authentication** | Override nothing (`AuthorizationBuilderCtor` defaults to `null`) |

## Declare a service-wide key with `AuthorizationBuilderCtor` plus `authorizationApiKey`

For an operation authenticated with an API token from `env`, implement two getters on the payload. The
builder assembles the header string (`Bearer xxx`), so do not write `headers` by hand.

- **Why**: turning the generation scheme (Bearer / Basic) and the key into declarations confines the
  header-assembly difference to the payload. Written by hand, you risk a missing `Bearer ` prefix or
  a forgotten Base64 encoding.

```js
import {
  env,
} from '../globals/_.js'

import {
  BasePayload,
  BearerAuthorizationBuilder,
  REST_METHOD,
} from '@openreachtech/mentsu-rocket-client'

export default class FindDocumentsPayload extends BasePayload {
  /** @override */
  static get method () {
    return REST_METHOD.GET
  }

  /** @override */
  static get pathname () {
    return '/v1/projects/[projectId]/documents'
  }

  /**
   * get: AuthorizationBuilder constructor.
   *
   * @override
   * @returns {typeof BearerAuthorizationBuilder}
   */
  static get AuthorizationBuilderCtor () {
    return BearerAuthorizationBuilder
  }

  /**
   * get: authorization API key.
   *
   * @override
   * @returns {string}
   */
  static get authorizationApiKey () {
    return env.DOCUMENT_API_TOKEN
  }
}
```

## Pass a per-request token through `optionHash.headers.Authorization`

For a token that changes per request, such as a user's access token, set `AuthorizationBuilderCtor` on
the payload but leave `authorizationApiKey` as `null`, and pass the header through `optionHash` when
building the payload.

- **Why keep `AuthorizationBuilderCtor`**: so that "make a missing token an error", below, takes effect.

```js
const payload = FindDocumentsPayload.create({
  pathParameterHash: {
    projectId: 'fake-project-id-001',
  },
  query: {
    keyword: 'fake-keyword-001',
    limit: 20,
  },
  optionHash: {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  },
})
```

## To make a missing token an error, always set `AuthorizationBuilderCtor`

When `AuthorizationBuilderCtor` is `null` (the default), `hasAuthorization()` is always `true` — no
validation. To have a missing token treated as a "no-authorization error `Capsule`", set
`AuthorizationBuilderCtor`.

- **Why**: with no builder set, rocket-client reads that as "no authentication needed" and skips the
  check. Omitting the builder on an operation that does need authentication sends the `fetch` without a
  token and leaves you relying on the external API's 401 — the benefit of validating before sending is
  gone. Do not omit the builder where authentication is required.
