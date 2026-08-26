# Architecture (the whole picture: three classes, data flow, layout)

The whole picture of rocket-client: how one request is split across **Launcher / Payload / Capsule**,
the data flow between them, the directory layout, and the classes the module provides for you to swap
in. Referenced from [SKILL.md](../SKILL.md). For how to write each individual layer, see
[launcher.md](./launcher.md) / [payload.md](./payload.md) / [capsule.md](./capsule.md).

## Split the responsibilities across three classes

One external API request is always implemented in these three layers. All of them are `import`ed from
`@openreachtech/mentsu-rocket-client`.

| Layer | Base class | Role | Granularity |
| :-- | :-- | :-- | :-- |
| **Launcher** | `BaseLauncher` | Runs the request. Has `fetch` built in; `launchRequest()` covers sending through to producing the `Capsule` | Per service (base) plus per API operation (derived) |
| **Payload** | `BasePayload` | The input definition of one request. Holds method / path / query / body / authentication / key and value conversion | Per API operation |
| **Capsule** | `BaseCapsule` | The response wrapper. Provides `body` / `statusCode` / `hasError()`, and pulls values out with `extractXxx()` | Per API operation |

- **Per service** (say, some SaaS's REST API) there is **one** **base launcher**
  (`Base<Service>Launcher`) holding `clientConfig` (base URL and so on).
- **Per API operation** (say, creating a document) there is **one set** of `Payload` / `Capsule` plus
  the **derived launcher** (`<Operation>Launcher`) that ties them together.
- **Why this granularity**: connection settings (base URL, credentials) are shared across the service,
  so they are collected in the base; input and output differences vary per operation, so they are
  split per operation. Adding a new operation is then "add three derived files" and nothing about the
  existing operations changes.

## Data flow: the caller only assembles and hands over

The caller builds a `Payload` and calls `launcher.launchRequest({ payload })` — that is all.
`launchRequest()` (provided by `BaseLauncher`) then runs this flow.

```
caller
  │  pathParameterHash / query / body / optionHash
  ▼
Launcher.createPayload({ ... })            ← shortcut for Payload.create()
  │  payload
  ▼
launcher.launchRequest({ payload, hooks })  ← provided by BaseLauncher
  │
  ├─ payload.hasAuthorization()        ─ false ─▶ Capsule (no-authorization error)
  ├─ payload.hasInvalidParameterHash() ─ true  ─▶ Capsule (invalid-input error)
  ├─ hooks.beforeRequest(payload)      ─ true  ─▶ Capsule (aborted-by-hooks)
  │
  ├─ payload.createFetchRequest({ baseUrl })   ← assembles path, query, body, headers
  │        │ Request
  │        ▼
  │  BaseLauncher.fetch(request)               ← native fetch (exceptions swallowed into null)
  │        │ Response | null
  │        ▼
  │  ResponseBodyParser.parseBody()            ← JSON parsing by default
  │
  ├─ network failure ─▶ Capsule (network error)
  ├─ parse failure   ─▶ Capsule (response-body-parse error)
  └─ success         ─▶ Capsule (holding rawResponse / body)
  │
  ▼
hooks.afterRequest(capsule)
  │
  ▼
capsule.hasError() / capsule.extractXxx()   ← the caller pulls values out
```

- Before sending, the `Payload` **validates itself** with `hasAuthorization()` and
  `hasInvalidParameterHash()`, and on invalid input returns an error `Capsule` without calling `fetch`.
- `fetch` exceptions and body-parse failures are caught inside `BaseLauncher` and converted into the
  `Capsule` for the corresponding error kind. **That is why the caller decides failure with
  `capsule.hasError()` rather than `try-catch`**
  ([SKILL.md](../SKILL.md#decide-failure-with-capsulehaserror-not-try-catch)).

## Directory layout

| What | Where | Example |
| :-- | :-- | :-- |
| Implementation | `app/<serviceName>Client/` | `app/documentApiClient/` |
| Tests | `tests/__tests__/app/<serviceName>Client/` | `tests/__tests__/app/documentApiClient/` |

The files for one operation (the service base plus the operation's three):

```
app/documentApiClient/
  BaseDocumentApiLauncher.js      ← base launcher (clientConfig = BASE_URL, fetch, …)
  CreateDocumentLauncher.js       ← derived launcher (ties Payload / Capsule together)
  CreateDocumentPayload.js        ← input definition (method / pathname / schema / authentication)
  CreateDocumentCapsule.js        ← output extraction (extractXxx)
```

- **Why separate files**: one class per file is a repository-wide convention
  ([conventions.md](./conventions.md)). The base launcher and the derived launcher are separate files
  too, so that what is shared across the service (connection settings) and what is specific to the
  operation (tying Payload/Capsule together) are kept in separate files.

## The classes the module provides (swapped in from `Payload` / `Capsule` / `Launcher`)

The behaviour of a `Payload` or a `Capsule` is swapped by returning one of the classes below from the
corresponding getter. All of them are exported from `@openreachtech/mentsu-rocket-client`.

| Kind | Class | Purpose | Where it is used |
| :-- | :-- | :-- | :-- |
| Core | `BaseLauncher` / `BasePayload` / `BaseCapsule` | The base classes of the three layers | The `extends` of each layer |
| Authentication | `BearerAuthorizationBuilder` / `BasicAuthorizationBuilder` (base `BaseAuthorizationBuilder`) | How the `Authorization` header is produced | The payload's `AuthorizationBuilderCtor` ([authorization.md](./authorization.md)) |
| Request key conversion | `SnakeCasedKeyRequestQuery` / `SnakeCasedKeyRequestBody` | Internal camelCase → outgoing snake_case | The payload's `RequestQueryCtor` / `RequestBodyCtor` ([payload.md](./payload.md)) |
| Response key conversion | `CamelCasedKeyResponseBody` (base `ResponseBody`) | Incoming snake_case → internal camelCase | The capsule's `ResponseBodyCtor` ([capsule.md](./capsule.md)) |
| Body formatting | `JsonRequestBodyStringifier` / `NdjsonRequestBodyStringifier` (base `BaseRequestBodyStringifier`) | How the request body is stringified | Payload |
| Response parsing | `JsonResponseBodyParser` / `BlobResponseBodyParser` (base `BaseResponseBodyParser`) | How the response body is parsed | The launcher's `ResponseBodyParser` (JSON by default) |
| Constants | `REST_METHOD` / `LAUNCH_ABORTED_REASON` | The HTTP method enum / the abort-reason enum | The payload's `method`, and so on |

- The scalars used in `querySchema` / `bodySchema` (`TextScalar` / `KeywordScalar` / `IntegerScalar` /
  `DatetimeScalar`, …) are `import`ed from **`@openreachtech/mentsu-schema`**, not from rocket-client.
- **Installing**: `npm install @openreachtech/mentsu-rocket-client` — it is published to npmjs.com,
  so no registry configuration or authentication is required.

## The two transport patterns

A launcher that calls an external API comes in two patterns, depending on the transport. The way
differences are absorbed (input in the `Payload`, output in the `Capsule`) is the same in both; **only
the transport step differs**.

| Pattern | Transport | When to use | Implementation |
| :-- | :-- | :-- | :-- |
| **Direct HTTP** (default) | The `fetch` built into `BaseLauncher` | No vendor SDK / hitting REST directly | Nothing extra to implement. Define `clientConfig` / `Payload` / `Capsule` ([launcher.md](./launcher.md)) |
| **SDK wrapping** | The SDK the vendor provides | An official SDK/client exists | The launcher holds the SDK and overrides `launchRequest()` ([sdk-wrapper.md](./sdk-wrapper.md) — an interim implementation) |

- A new REST integration is **direct HTTP** by default. SDK wrapping is an **interim
  implementation** until rocket-client supports it properly, so use it only where an SDK is
  provided.
