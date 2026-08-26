# Engine, context, and share (the app-wide layer)

Three classes set up the whole REST surface. They mirror the GraphQL engine/context/share: the
**engine** wires routes, middleware, auth, and the standard errors; the **context** is built fresh
per request; the **share** is a single per-process object.

## Engine

`AppRestfulApiServerEngine extends BaseRestfulApiServerEngine`. It is the single place that
configures the REST layer.

```js
import express from 'express'
import cors from 'cors'

import {
  BaseRestfulApiServerEngine,
} from '@openreachtech/renchan'

import rootPath from '../../app/globals/root-path.js'

import AppRestfulApiShare from './contexts/AppRestfulApiShare.js'
import AppRestfulApiContext from './contexts/AppRestfulApiContext.js'

export default class AppRestfulApiServerEngine extends BaseRestfulApiServerEngine {
  /** @override */
  static get config () {
    return {
      pathPrefix: '/v1', // prepended to every routePath; null = none
      renderersPath: rootPath.to('server/restfulapi/renderers/v1/'),
      staticPath: rootPath.to('public/'),
    }
  }

  /** @override */
  static get Share () {
    return AppRestfulApiShare
  }

  /** @override */
  static get Context () {
    return AppRestfulApiContext
  }

  // ... standardErrorEnvelopHash, generateFilterHandler, visaIssuers, collectMiddleware ...
}
```

- **`static get config()`** — `pathPrefix` (route prefix, e.g. `/v1`), `renderersPath` (the **one**
  version directory whose renderers this engine serves), `staticPath` (static files root). To serve
  a second version, run an engine pointed at `renderers/v2/` with `pathPrefix: '/v2'`.
- **`static get Share()` / `static get Context()`** — the app Share / Context classes (below).
- **`static get standardErrorEnvelopHash()`** — the **cross-cutting** error envelopes, keyed by
  name, each `{ statusCode, errorMessage }`. The framework requires at least `Unknown`,
  `ConcreteMemberNotFound`, `Unauthenticated`, `Unauthorized`, `Database`. These back the engine's
  own `errorResponseHash` (used by the filter handler); per-endpoint errors live on the renderer
  (`errorStructureHash`).

```js
/** @override */
static get standardErrorEnvelopHash () {
  return {
    Unknown: {
      statusCode: 500,
      errorMessage: 'Unknown error',
    },
    Unauthenticated: {
      statusCode: 401,
      errorMessage: 'Unauthenticated',
    },
    Unauthorized: {
      statusCode: 403,
      errorMessage: 'Unauthorized',
    },
    // ConcreteMemberNotFound, Database, ...
  }
}
```

- **`collectMiddleware()`** — the express middleware stack (cors, JSON / urlencoded body parsers,
  static file serving, …). Returns an array applied in order.

## The auth filter: `generateFilterHandler()` + `visaIssuers`

Authentication/authorization is a **cross-cutting filter** run before `render()` for every renderer
whose `passesFilter` is `false`. Two pieces:

- **`get visaIssuers()`** — async predicates that populate the request's **visa**, each given
  `{ expressRequest, userEntity, engine }`:

```js
/** @override */
get visaIssuers () {
  return {
    hasAuthenticated: async ({
      userEntity,
    }) => userEntity !== null,
    hasAuthorized: async ({
      userEntity,
    }) => true,
    hasPathPermission: async ({
      userEntity,
    }) => true,
  }
}
```

- **`generateFilterHandler()`** — returns an async `({ body, query, context, request }) => errorResponse | null`.
  Read the visa via the context and **return an error response to reject**, or `null` to allow:

```js
/** @override */
generateFilterHandler () {
  return async ({
    context,
  }) => {
    if (!context.hasAuthenticated()) {
      return this.errorResponseHash.Unauthenticated.createAsError()
    }

    if (!context.hasAuthorized()) {
      return this.errorResponseHash.Unauthorized.createAsError()
    }

    return null
  }
}
```

A renderer with `get passesFilter () { return true }` skips this entirely (public endpoint).

## Context (per request)

`AppRestfulApiContext extends BaseRestfulApiContext`. The framework builds it **per request**:
it extracts the access token from the header (`x-renchan-access-token`), calls `findUser`, and
builds the visa from the engine's `visaIssuers`.

```js
import {
  BaseRestfulApiContext,
} from '@openreachtech/renchan'

export default class AppRestfulApiContext extends BaseRestfulApiContext {
  /**
   * Resolve the authenticated user from the access token.
   *
   * @override
   * @param {{
   *   expressRequest: ExpressType.Request
   *   accessToken: string | null
   *   now?: Date
   * }} params
   * @returns {Promise<renchan.UserEntity | null>}
   */
  static async findUser ({
    expressRequest,
    accessToken,
    now = new Date(),
  }) {
    // look up the token → return the user entity, or null
  }
}
```

The context is what `render()` receives as `context`. It exposes:

- **`now`** — the request timestamp (`requestedAt`); use it so all writes in the request share one
  time.
- **`userId` / `userEntity`** — the authenticated user (or `null`).
- **`share`** — the per-process share (below); **`env`** / **`NODE_ENV`** — configuration.
- **`hasAuthenticated()` / `hasAuthorized()` / `hasPathPermission()` / `canRender()`** — the visa
  predicates the filter handler reads.
- **`uuid`** — a per-request id.

Override `findUser` to do the token → user lookup. Add domain-neutral aliases if useful (e.g. a
`provider` getter aliasing `userEntity`), but keep app-specific naming out of the base pattern.

## Share (per process)

`AppRestfulApiShare extends BaseRestfulApiShare`. A single object created once at startup, reachable
as `context.share`. It holds `env` and is the place for **shared, long-lived collaborators** (an
external-API client, a provider). Often a `// noop` subclass until something needs sharing:

```js
import {
  BaseRestfulApiShare,
} from '@openreachtech/renchan'

export default class AppRestfulApiShare extends BaseRestfulApiShare {
  // noop
}
```
