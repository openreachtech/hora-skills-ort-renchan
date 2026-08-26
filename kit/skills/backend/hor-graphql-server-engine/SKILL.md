---
name: hor-graphql-server-engine
description: >
  Implement and wire a GraphQL server engine — a per-endpoint *GraphqlServerEngine class under
  server/graphql/ that declares one endpoint's URL, schema path, resolver directories, Share and
  Context DI, auth filter, middleware, scalars and error codes, then is booted in server/index.js.
  Use whenever the user asks to add a GraphQL endpoint (a new role such as user / admin / portal),
  pair a stub engine with an actual one, change its auth policy or public-operation allowlist, or
  enable Redis PubSub.
---

# GraphQL Server Engine

A skill for the **`*GraphqlServerEngine` classes under `server/graphql/`**. An engine is the one
object that **wires a single GraphQL endpoint**: its URL and port, which schema and resolver
directories to load, the Share / Context dependency-injection classes, the authentication filter,
the Express middleware, the custom scalars, and the error-code hash. `server/index.js` then boots
**one HTTP server per engine** through `GraphqlServerBuilder`.

The engine sits *above* the pieces other skills build: resolvers (`hor-resolver-validator`
validates their input), post-workers (`hor-post-worker` run after they resolve),
and jobs they enqueue (`hor-renchan-job-bullmq`). This skill is about the
**wiring layer** that mounts all of them onto an endpoint.

> The class names, endpoints, and ports below (`CustomerGraphqlServerEngine`, `/graphql-customer`, …)
> are **placeholders**; the pattern is the general Renchan convention. Adapt the anchors to whatever
> roles your project has.

## What an engine configures (the whole surface)

An engine file is the **entry-point configuration** for one API endpoint. Everything it declares is
one of these settings — nothing more:

| Setting | Member | Section |
| --- | --- | --- |
| Endpoint routing (URL, schema / resolver dirs, redis) | `static get config` | [§2](#2-static-get-config--the-endpoints-routing-declaration) |
| Middleware (cors / json / static / upload / urlencoded) | `collectMiddleware()` | [§6](#6-middleware-scalars-error-codes) |
| Share / Context DI classes | `static get Share` / `static get Context` | [§3](#3-share-and-context--the-di-the-engine-hands-to-every-resolver) |
| Custom scalars | `collectScalars()` | [§6](#6-middleware-scalars-error-codes) |
| Auth policy — the **no-auth (public) operations** + the filter | `schemasToSkipFiltering` + `generateFilterHandler()` | [§4](#4-authentication-schemastoskipfiltering--generatefilterhandler) |
| Shared error codes | `standardErrorCodeHash` | [§6](#6-middleware-scalars-error-codes) |

**App-common settings are not repeated per engine** — they are lifted into an **app base class**
(`BaseAppGraphqlServerEngine`) that every engine extends ([§1](#1-two-base-classes-put-app-common-settings-in-an-app-base-and-extend-it)).

## Grand principle: one endpoint = one engine, and the engine only *declares and wires*

Each GraphQL endpoint (a role such as `user` / `admin` / `portal`) gets **exactly one engine class**.
The engine **holds no business logic** — no DB queries, no response building, no request handling. It
is a thin **declaration + composition** object: routing config, DI wiring (`Share` / `Context`),
and cross-cutting policy (auth filter, error mapping, scalars, middleware). All real work lives in
the resolvers and the context; the engine just points at them.

- **Why a class per endpoint**: each role has its own schema, its own resolver set, its own auth
  audience, and its own port. Keeping them in separate engine classes means a role's policy changes
  in one file, and adding a role never edits an existing engine (Open-Closed).
- **Why no logic in the engine**: the engine is instantiated once at boot and shared across every
  request. Anything stateful or per-request belongs in `Context` (per request) or `Share` (per
  process); anything domain-specific belongs in a resolver. An engine that starts doing work becomes
  a god object that every endpoint's behavior routes through.
- **Extend the app base, override only what differs.** The shared middleware and error codes live in
  the app base ([§1](#1-two-base-classes-put-app-common-settings-in-an-app-base-and-extend-it)); a concrete engine should be
  mostly `config` + `Share` + `Context` + auth policy.

**Comment language**: the `js` examples in this SKILL.md use English comments (matching the framework
files). In the **engine files you generate** (`*GraphqlServerEngine.js`), keep structural comments in
English and any domain notes in the surrounding language of the repo — same rule the other skills use.

## 1. Two base classes: put app-common settings in an app base and extend it

There are two layers of base class. The pattern is: **the framework base defines the contract; an
app base holds the settings shared across your endpoints; each concrete engine extends the app base
and overrides only what is endpoint-specific.**

| Base | Where | Role |
| --- | --- | --- |
| `BaseGraphqlServerEngine` | `@openreachtech/renchan` | The **framework contract**: factory (`create` / `createAsync`), `buildErrorHash`, and the abstract members every engine fills in (`config`, `Share`, `Context`, `collectMiddleware`, `generateFilterHandler`, …). |
| `BaseAppGraphqlServerEngine` | `server/graphql/BaseAppGraphqlServerEngine.js` | **This app's shared settings** — factor here anything common to every endpoint: the shared `collectMiddleware()` (cors / json / static / upload / urlencoded) and `standardErrorCodeHash`. |

- **When a setting is the same for every endpoint, lift it into the app base.** Middleware and the
  error-code hash are the usual ones. Each concrete engine then extends `BaseAppGraphqlServerEngine`
  and declares only the parts that differ per endpoint — `config`, `Share`, `Context`, and the auth
  policy. This keeps one source of truth for the shared config (Open Reach Tech's DRY / "carve once"
  stance) and makes a new endpoint a short file.
- **Only override a shared member to change it** for one endpoint — e.g. the user endpoint overrides
  `collectMiddleware()` just to raise the body limit to `30mb` ([§6](#6-middleware-scalars-error-codes)).
- Prefer having the app base hold the shared middleware + error codes and every engine — **stub** and
  **actual** — extend it. If some engines still extend the framework base directly and repeat those
  members, migrate them to the app base when you next touch an engine so the shared settings live in
  one place.

```js
// Good: a new engine extends the app base and declares only the endpoint-specific parts
import BaseAppGraphqlServerEngine from './BaseAppGraphqlServerEngine.js'
import PartnerGraphqlShare from './contexts/PartnerGraphqlShare.js'
import PartnerGraphqlContext from './contexts/PartnerGraphqlContext.js'

export default class PartnerGraphqlServerEngine extends BaseAppGraphqlServerEngine {
  /** @override */ static get config () { /* ... §2 ... */ }
  /** @override */ get schemasToSkipFiltering () { /* ... §4 ... */ }
  /** @override */ generateFilterHandler () { /* ... §4 ... */ }
  /** @override */ static get Share () { return PartnerGraphqlShare }
  /** @override */ static get Context () { return PartnerGraphqlContext }
  /** @override */ async collectScalars () { /* ... §6 ... */ }
  // collectMiddleware() / standardErrorCodeHash inherited from the app base
}
```

## 2. `static get config` — the endpoint's routing declaration

`config` is the one place the endpoint's URL and file locations are declared. The shape is fixed
(`GraphqlType.Config`):

| Key | Meaning |
| --- | --- |
| `graphqlEndpoint` | The URL path this engine serves (`'/graphql-admin'`). Unique per engine. |
| `staticPath` | Directory served as static files (`rootPath.to('public/')`). |
| `schemaPath` | The `.graphql` schema file **or** a directory of them (`server/graphql/schemas/user`). |
| `actualResolversPath` | Directory of the real resolvers (`.../resolvers/<role>/actual/`), or `null`. |
| `stubResolversPath` | Directory of stub resolvers (`.../resolvers/<role>/stub/`), or `null`. |
| `postWorkersPath` | Directory of post-workers, or `null` when unused ([§7](#7-post-resolve-hooks-defineonresolved--postworkerspath)). |
| `redisOptions?` | Redis connection for subscription PubSub; omit / `null` → in-process `LocalPubSub` ([§5](#5-stub-vs-actual-engines-and-subscriptions-redis-vs-local)). |

```js
// Good: config is a pure routing declaration; paths via rootPath.to(), redis resolved in env
import { rootPath, env } from '../../app/globals/_.js'

/** @override */
static get config () {
  return {
    graphqlEndpoint: '/graphql-customer',
    staticPath: rootPath.to('public/'),
    schemaPath: rootPath.to('server/graphql/schemas/customer'),
    actualResolversPath: rootPath.to('server/graphql/resolvers/customer/actual/'),
    stubResolversPath: rootPath.to('server/graphql/resolvers/customer/stub/'),
    postWorkersPath: rootPath.to('server/graphql/post-workers/customer/'),
    redisOptions: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
    },
  }
}
```

- **Always resolve paths with `rootPath.to(...)`** (`app/globals/root-path.js`),
  never hand-built relative strings.
- **`graphqlEndpoint` must be unique** across all engines (each maps to its own path + port in
  `server/index.js`, [§8](#8-wiring-into-serverindexjs)).
- **Keep `config` a pure declaration — never put logic in the getter.** Resolve the redis connection
  in the **`env` layer**: `env.redisOptions` returns `{ host, port }` on staging / live and `null` in
  dev (no Redis), so the getter just references it. Dev then falls back to `LocalPubSub`; staging /
  live opt in via environment. Do **not** branch inside `config` (`env.REDIS_HOST ? { … } : null`) —
  a getter must return a value, not compute one.

## 3. `Share` and `Context` — the DI the engine hands to every resolver

Two static getters name the DI classes this endpoint uses. The framework instantiates them and
threads them into every resolver call.

- **`static get Share`** → the per-**process** shared object (`Base…GraphqlShare`). Built once at boot
  (`createAsync`), it holds process-wide clients (`env`, the subscription `broker`, external clients,
  a `jobDispatcherProvider`, …). This is what `hor-post-worker` reaches through
  `context.share` to dispatch jobs.
- **`static get Context`** → the per-**request** object (`Base…GraphqlContext`). Built for each request
  from the access token; it exposes the authenticated principal (`context.admin` / `context.userId`)
  and the **visa** the auth filter reads ([§4](#4-authentication-schemastoskipfiltering--generatefilterhandler)).

```js
// Good: the engine only names the classes; the classes hold the DI
/** @override */ static get Share () { return AdminGraphqlShare }
/** @override */ static get Context () { return AdminGraphqlContext }
```

- **Each endpoint pairs its own Share + Context** (`Admin*` with `Admin*`); do not share one role's
  Context with another endpoint — the principal and permissions differ.
- The Share / Context implementations themselves (findUser, visa issuing, extra clients) are their own
  concern; this skill only wires them onto the engine. (See the `contexts/` classes such as
  `AdminGraphqlContext.js` /
  `AdminGraphqlShare.js`.)

## 4. Authentication: `schemasToSkipFiltering` + `generateFilterHandler`

Every operation on the endpoint runs through the engine's **filter handler** before its resolver —
**except** operations named in `schemasToSkipFiltering`. This pair *is* the endpoint's auth policy.

- **`get schemasToSkipFiltering`** → an **allowlist of public operation names** (GraphQL field names)
  that skip the filter entirely: `signIn`, `resetPassword`, sign-up, unauthenticated public reads.
  Default is `[]` (everything is filtered).
- **`generateFilterHandler()`** → returns `async ({ variables, context, information, parent }) => {}`.
  It reads the operation name from `information.fieldName` and gates it through the request
  `context`'s **visa**, throwing the matching error from `this.errorHash` on failure.

```js
// Good: the standard four-step gate (per-operation allow → authn → authz → per-schema permission)
/** @override */
get schemasToSkipFiltering () {
  return [
    'signIn',
    'resetPassword',
    'generatePasswordResetUrl',
    'generateAccessTokenByOAuthCode',
  ]
}

/** @override */
generateFilterHandler () {
  return async ({ variables, context, information, parent }) => {
    const schema = information.fieldName

    // A per-operation visa grant (e.g. owner of the record) short-circuits the rest.
    if (context.canResolve({ schema })) {
      return
    }

    if (!context.hasAuthenticated()) {
      throw this.errorHash.Unauthenticated.create()
    }

    if (!context.hasAuthorized()) {
      throw this.errorHash.Unauthorized.create()
    }

    if (!context.hasSchemaPermission({ schema })) {
      throw this.errorHash.DeniedSchemaPermission.create({ value: { schema } })
    }
  }
}
```

- **The four checks are a fixed ladder**: `canResolve` (a visa grant issued for this operation) →
  `hasAuthenticated` (a valid principal) → `hasAuthorized` (the principal is active/allowed) →
  `hasSchemaPermission` (this principal may call this specific operation). Each reads `context.visa`;
  keep the order and the early returns.
- **`schemasToSkipFiltering` is security-critical.** An entry here is **fully public**. Only put
  genuinely unauthenticated operations in it; never place a sensitive mutation there to "make it
  work". Conversely, a public operation missing from the list will 401. This is exactly check #3 of
  `hor-security-audit` — every operation authenticated unless intentionally public.
- **Do not do real work in the filter.** It decides allow/deny from the visa only; it must not run
  business queries or mutate state.

```js
// Avoid: an empty filter on a NON-stub engine — disables auth for the whole endpoint
/** @override */
generateFilterHandler () {
  return async () => {} // every operation now unauthenticated. Only stub engines may do this (§5).
}
```

## 5. Stub vs actual engines (and subscriptions: Redis vs Local)

Each role is served by **two** engines on **two ports**:

| Kind | Extends | Resolvers | Auth filter | Purpose |
| --- | --- | --- | --- | --- |
| **actual** | (app base) | `actualResolversPath` → real resolvers | the real four-step gate | production behavior |
| **stub** | app base | `actualResolversPath` **points at the stub dir** | `generateFilterHandler` returns a **noop** | frontend/dev fixtures without auth |

- A stub engine is a thin copy with a different `graphqlEndpoint` (`…-stub`), its
  `actualResolversPath` set to the **stub** resolver directory, and an **auth-disabled** filter
  (`return async () => {}`, `schemasToSkipFiltering: []`). It exists so the frontend can develop
  against canned data. **Auth-off is acceptable only because a stub serves fake data on a separate
  port** — never ship a stub engine's config on a real endpoint.
- **Subscriptions PubSub**: when `config.redisOptions` is set, progress/subscription events go through
  **Redis PubSub** (required when a separate process — e.g. the job daemon — publishes to
  subscribers, see `hor-renchan-job-bullmq` §4). When it is `null`, the
  engine uses an in-process `LocalPubSub` — fine for dev and single-process endpoints. Enable Redis on
  the endpoints whose subscriptions are fed by another process.

## 6. Middleware, scalars, error codes

The remaining overrides are cross-cutting endpoint policy:

- **`collectMiddleware()`** → the Express middleware array (cors, `express.json({ limit })`,
  `express.static`, the upload middleware, `express.urlencoded` capturing `rawBody`). Inherit it from
  the app base; only override to change a limit (e.g. the user endpoint raises the body limit to
  `30mb` for uploads).
- **`async collectScalars()`** → the custom GraphQL scalars this endpoint exposes
  (`DateTimeScalar`, `BigNumberScalar`). Return only what the schema uses.
- **`static get standardErrorCodeHash`** → maps the framework error names (`Unauthenticated`,
  `Unauthorized`, `DeniedSchemaPermission`, `Database`, `Unknown`, `ConcreteMemberNotFound`) to this
  app's numeric codes. Inherit from the app base; the engine's `this.errorHash` (used in §4) is built
  from it.
- **`passesThoughError()`** (default: true in pre-production) lets raw errors through outside
  production and maps them to `errorHash` codes in production — do not disable error mapping in prod.

```js
// Good: only override middleware to change a limit; otherwise inherit from the app base
/** @override */
collectMiddleware () {
  return [
    cors({ origin: '*' }),
    express.json({ limit: '30mb' }), // this endpoint accepts large uploads
    express.static(this.config.staticPath),
    graphqlUploadExpressWithResolvingContentType({ maxFileSize: 10000000, maxFiles: 10 }),
    express.urlencoded({ extended: true, verify: (req, res, body) => { req['rawBody'] = body.toString() } }),
  ]
}
```

## 7. Post-resolve hooks: `defineOnResolved` + `postWorkersPath`

Two ways to run something *after* a resolver returns, both wired on the engine:

- **`config.postWorkersPath`** → a directory of per-operation post-workers, auto-loaded and matched by
  operation name. This is how `hor-post-worker` fires. `null` → post-workers never
  run. Set it to `server/graphql/post-workers/<role>/` to enable them for the endpoint.
- **`defineOnResolved()`** → an **engine-wide** (all operations) after-resolve hook; default noop. Use
  it for a cross-cutting after-hook; use a `postWorkersPath` post-worker for a **specific** operation.
  The same "dispatch only, no heavy logic" rule as post-worker applies.

## 8. Wiring into `server/index.js`

An engine does nothing until it is booted. `server/index.js` starts **one
HTTP server per engine** with `GraphqlServerBuilder`, each on its own port:

```js
// Good: register the new engine — import it, build, and listen on a free port
import PartnerGraphqlServerEngine from './graphql/PartnerGraphqlServerEngine.js'

GraphqlServerBuilder.createAsync({
  Engine: PartnerGraphqlServerEngine,
})
  .then(builder =>
    builder.buildHttpServer()
      .listen(6000)
  )
```

An endpoint → port layout looks like this (roles, paths, and ports are illustrative — use your own):

| Engine | `graphqlEndpoint` | Port (example) |
| --- | --- | --- |
| `CustomerGraphqlServerEngine` | `/graphql-customer` | 4000 |
| `StubCustomerGraphqlServerEngine` | `/graphql-customer-stub` | 4001 |
| `AdminGraphqlServerEngine` | `/graphql-admin` | 4100 |
| `StubAdminGraphqlServerEngine` | `/graphql-admin-stub` | 4101 |

- `createAsync({ Engine })` calls the engine's `createAsync`, which builds the `Share`
  (`Share.createAsync({ config })`) and constructs the engine; `buildHttpServer().listen(port)` mounts
  it. **Adding an endpoint = new engine file + these ~6 lines**; forgetting the second step means the
  engine is dead code.
- **Pick a unique port** not already used by another engine (including any non-GraphQL engine, such
  as a REST server).
- Pair the actual engine with its stub engine here too (both get their own `createAsync` + `listen`).

## Finishing checklist

- [ ] One engine per endpoint, extending the **app base** ([§1](#1-two-base-classes-put-app-common-settings-in-an-app-base-and-extend-it)); no duplicated middleware / error hash unless the endpoint truly differs.
- [ ] The engine is **declaration + wiring only** — no DB queries, no response building, no per-request state in the engine.
- [ ] `config` has a **unique `graphqlEndpoint`**, `rootPath.to(...)` paths for schema / resolvers, and `redisOptions` from `env` (or `null`) ([§2](#2-static-get-config--the-endpoints-routing-declaration)).
- [ ] `static get Share` / `static get Context` name **this role's own** Share + Context ([§3](#3-share-and-context--the-di-the-engine-hands-to-every-resolver)).
- [ ] `schemasToSkipFiltering` lists **only genuinely public** operations; the filter runs the four-step visa gate; **no real work** in the filter ([§4](#4-authentication-schemastoskipfiltering--generatefilterhandler)).
- [ ] A **stub** engine (if added) points `actualResolversPath` at the stub dir and uses a **noop** filter — and never leaks that config onto a real endpoint ([§5](#5-stub-vs-actual-engines-and-subscriptions-redis-vs-local)).
- [ ] Redis PubSub enabled on endpoints whose subscriptions are published by **another process** ([§5](#5-stub-vs-actual-engines-and-subscriptions-redis-vs-local)).
- [ ] `postWorkersPath` set when the endpoint needs post-workers (`null` disables them) ([§7](#7-post-resolve-hooks-defineonresolved--postworkerspath)).
- [ ] Engine **registered in `server/index.js`** with a unique port ([§8](#8-wiring-into-serverindexjs)).
