---
name: hb-external-api-client
description: >
  Implement a client for an external HTTP/REST API using
  `@openreachtech/mentsu-rocket-client` (the Launcher / Payload / Capsule three-class
  structure). Use this skill whenever the user asks to add or change an external API
  integration — a new service client, a new API operation, request/response key
  conversion, authorization headers, or wrapping a vendor SDK — under
  `app/<serviceName>Client/`. For the raw source guide see the doc linked at the bottom.
---

# External API Client

How to implement a client for an external HTTP/REST API with `@openreachtech/mentsu-rocket-client`
(rocket-client from here on). One external request is split across three classes —
**Launcher / Payload / Capsule**. The conventions are divided into the detail files listed at the
bottom; read the one that matches what you are doing.

## First principle: confine every difference from the external API to Payload / Capsule (anti-corruption layer)

Every convention in this skill follows from one goal: **an external API's interface differences must
stay out of application code.** Key names, value formats, paths, authentication and response shapes
of an external API can all change, and they disagree with our own naming conventions anyway. Confine
those differences to **a single layer (the anti-corruption layer)** so the caller (a resolver or a
job) never has to know about them.

- **Differences on the way in** (key names, value formats, path, query, authentication) belong to
  **`Payload`**.
- **Differences on the way out** (response key names, nesting, missing fields) belong to
  **`Capsule`'s `extractXxx()`**.
- The caller only builds a `Payload` and pulls values out of a `Capsule`. **If the external API's raw
  shape reaches the caller, this layer has failed.**
- **Why**: without this layer — or with a thin one — every change to the external API forces edits in
  resolvers and jobs, and the reach of a change becomes impossible to see. Collecting the differences
  in one place is what keeps a spec change contained to `Payload` / `Capsule`. When an individual
  rule leaves you unsure, decide it by extending this principle: which class owns this difference?

## Cross-cutting rules (they apply to every layer)

### HTTP goes through the native `fetch` only — no axios, no HTTP client of your own

In the direct-HTTP pattern, communication is handled by the **Node.js native `fetch`** built into
`BaseLauncher`. **Do not add another HTTP client module such as axios**, and do not implement an HTTP
client or Fetcher class of your own. Wrap an SDK only when the vendor publishes an official one
([sdk-wrapper.md](./references/sdk-wrapper.md) — an interim implementation).

- **Why**: because the transport is centralized in `BaseLauncher`, retries, error conversion and
  swapping in a stub for tests all take effect in one place. If each client brings its own axios, that
  benefit is gone and the transport ends up implemented differently per operation.

### Decide failure with `capsule.hasError()`, not `try-catch`

`launchRequest()` catches `fetch` exceptions and body-parse failures internally and returns the
`Capsule` for the corresponding error kind. The caller **writes no `try-catch`** and decides failure
from the returned `capsule.hasError()`.

- **Why**: funnelling missing authentication, invalid input, network failure, parse failure and a
  status >= 400 into one path — the "error `Capsule`" — is this module's design. A caller that adds
  `try-catch` on top handles errors through two channels, the caught exception and the `Capsule`, and
  a case will fall through the gap.

### Return `null` (or an empty array) for a missing value, never `undefined`

When an `extractXxx()` or a getter cannot produce a value, return **`null`** — or an **empty array**
for something that returns an array, or whatever the intended default is — not `undefined`.

- **Why**: `undefined` cannot be told apart from "undefined behaviour / not implemented yet". `null`
  (or an empty array) states the intent: the value was looked for and was not there. Details in
  [capsule.md](./references/capsule.md).

### Write comments in code in English

Comments in the real code you generate (`.js`) — `//`, `/* */`, JSDoc — are written in **English**, to
match the rest of the codebase. The ```js``` blocks in this skill are real code too, so their JSDoc
and comments are shown in English as well.

### Naming, and one class per file

**One class per file**, with a single `export default`. Name a derived launcher
`<Operation>Launcher`, and the payload and capsule `<Operation>Payload` / `<Operation>Capsule`, so the
operation is readable from the name. Pick the verb of a retrieval method by where the value comes
from (`fetch~` = external API, `find~` = the database, `extract~` = pulled out of a `Capsule`). The
remaining general coding conventions are in [conventions.md](./references/conventions.md).

## Detail files

- [architecture.md](./references/architecture.md) — the whole picture (the three classes, the data flow, directory layout, the classes the module provides)
- [launcher.md](./references/launcher.md) — Launcher (base and derived / direct HTTP, the members of `BaseLauncher`)
- [payload.md](./references/payload.md) — Payload (input definition, `method`/`pathname`, schema, key conversion)
- [capsule.md](./references/capsule.md) — Capsule (the response wrapper, `extractXxx()`, null guards)
- [authorization.md](./references/authorization.md) — authentication (`AuthorizationBuilderCtor` / `authorizationApiKey`)
- [sdk-wrapper.md](./references/sdk-wrapper.md) — the SDK-wrapping pattern (an interim implementation that overrides `launchRequest()`)
- [usage.md](./references/usage.md) — the implementation steps, and use from the caller (resolver / job), DI and hooks
- [testing.md](./references/testing.md) — unit tests for Payload / Capsule / Launcher
- [conventions.md](./references/conventions.md) — the naming and coding convention checklist

> This skill was made from the repository's external API client implementation guide. For reference
> material — rocket-client's own export list, its type definitions, examples of existing clients — see
> the "reference files" section at the end of that guide.
