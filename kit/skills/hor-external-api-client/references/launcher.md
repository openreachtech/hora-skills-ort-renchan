# Launcher (base and derived, direct HTTP)

How to write a launcher that extends `BaseLauncher`. This file covers the **direct-HTTP pattern**,
where the built-in `fetch` handles the transport. To wrap an SDK instead, see
[sdk-wrapper.md](./sdk-wrapper.md). Referenced from [SKILL.md](../SKILL.md); the whole picture is in
[architecture.md](./architecture.md).

## Do not implement an HTTP client of your own

A launcher **only declares the connection settings (`clientConfig`) and the `Payload` / `Capsule` it
uses**. The transport is the Node.js native `fetch` built into `BaseLauncher`, so do not import axios
and do not write an HTTP client or Fetcher class of your own
([SKILL.md](../SKILL.md#http-goes-through-the-native-fetch-only--no-axios-no-http-client-of-your-own)).

- **Why**: the design collects the transport, retries, error conversion and stub-swapping for tests
  into the single place that is `BaseLauncher`. A launcher that brings its own transport breaks that,
  and the transport ends up implemented differently per operation.

```js
// Bad: bringing in an HTTP client of your own, or axios
import axios from 'axios'

export default class CreateDocumentLauncher extends BaseDocumentApiLauncher {
  async launchRequest ({ payload }) {
    const response = await axios.post(/* ... */) // throws away BaseLauncher's fetch flow
    // ...
  }
}
```

## Base launcher: one per service, holding `clientConfig`

For each service (each external API) create one abstract base, `Base<Service>Launcher`, holding
`clientConfig` (the connection settings). Every operation's derived launcher extends it.

- `static get clientConfig ()` (override, **required**): returns `{ BASE_URL: ... }`. It becomes the
  default `config` for `create()` and is used as `baseUrl` (= `config[baseUrlKey]`, the default key
  being `'BASE_URL'`).
- Take the base URL, credentials and the like **from environment variables (`env`)**. Never hard-code
  the values.
- When the response is not JSON, override `static get ResponseBodyParser ()` with
  `BlobResponseBodyParser` or another parser (the default is `JsonResponseBodyParser`).
- `static get fetch ()` returns the native `fetch` by default. **This is what tests replace**
  ([testing.md](./testing.md)).
- **Why environment variables**: a base URL or an API token differs per environment (development /
  staging / live) and is also a secret. Going through `env` absorbs the difference between
  environments and keeps the secret out of the repository.

```js
import {
  env,
} from '../globals/_.js'

import {
  BaseLauncher,
} from '@openreachtech/mentsu-rocket-client'

export default class BaseDocumentApiLauncher extends BaseLauncher {
  /**
   * get: client configuration.
   *
   * @override
   * @returns {{
   *   BASE_URL: string
   * }}
   */
  static get clientConfig () {
    return {
      BASE_URL: env.DOCUMENT_API_BASE_URL,
    }
  }
}
```

## Derived launcher: one per API operation, tying `Payload` / `Capsule` together

It extends the base launcher and declares the `Payload` / `Capsule` this operation uses. It holds no
logic — it returns two getters and nothing else.

- `static get Payload ()` (override, **required**): returns this operation's `Payload` class.
- `static get Capsule ()` (override, **required**): returns this operation's `Capsule` class.
- **Why only getters**: the send flow (validate → `fetch` → parse → build the `Capsule`) lives
  entirely in `BaseLauncher`. The derived class works by declaring which input definition and which
  output wrapper to use. Adding logic here breaks the first principle — differences stay confined to
  Payload/Capsule.

```js
import BaseDocumentApiLauncher from './BaseDocumentApiLauncher.js'

import CreateDocumentPayload from './CreateDocumentPayload.js'
import CreateDocumentCapsule from './CreateDocumentCapsule.js'

export default class CreateDocumentLauncher extends BaseDocumentApiLauncher {
  /**
   * get: Payload class.
   *
   * @override
   * @returns {typeof CreateDocumentPayload}
   */
  static get Payload () {
    return CreateDocumentPayload
  }

  /**
   * get: Capsule class.
   *
   * @override
   * @returns {typeof CreateDocumentCapsule}
   */
  static get Capsule () {
    return CreateDocumentCapsule
  }
}
```

## `create()` adopts `clientConfig` when the argument is omitted

`BaseLauncher.create()` adopts `this.clientConfig` as `config` when called without arguments. The
caller gets a launcher carrying the connection settings assembled from environment variables with
nothing but `CreateDocumentLauncher.create()`.

- **Why**: so the caller never has to assemble the connection settings. The caller only cares which
  service and which operation — that is, which class — and never writes the base URL handover again.
  The steps for swapping it out through DI are in
  [usage.md](./usage.md#di-inject-a-stub-launcher).

## The main members `BaseLauncher` provides

| Member | Kind | Role |
| :-- | :-- | :-- |
| `static create({ config })` | factory | Builds a launcher (`config` defaults to `clientConfig`) |
| `static createPayload({ pathParameterHash, query, body, optionHash })` | static | Shortcut for `this.Payload.create(...)` |
| `launchRequest({ payload, hooks })` | instance | The entry point from sending the request through to building the `Capsule` |
| `get baseUrl` | getter | `config[baseUrlKey]` |

- The argument of `launchRequest()` is an **object** (`{ payload }`). Passing it positionally
  (`launchRequest(payload)`) leaves `payload` as `undefined` and the pre-send validation rejects the
  request, so watch for that.
