---
name: hb-restfulapi-architecture
description: >
  Understand and build the RESTful API layer of a renchan-style backend: the renderer architecture
  under server/restfulapi/. Use this skill whenever the user asks how the REST API is structured,
  where a REST endpoint lives, or how to add or edit one — a GET / POST / PUT / PATCH / DELETE
  Renderer, its route and version, the render() entry point, the response and error hashes, the
  per-request context and share, the engine's auth filter, and response flushers.
---

# RESTful API Architecture

A skill for understanding the **REST API layer** of a renchan-style backend — the code under
`server/restfulapi/`. Structurally it **mirrors the GraphQL layer**: there is a per-request
**context**, a per-process **share**, an **engine** that wires everything to the server, and an error
hash declared up front. The difference is the surface: instead of a resolver returning a plain
object, a **renderer** returns a **`RestfulApiResponse`** carrying an HTTP **status code** plus
`content` or `error`, and a **flusher** writes it to the response.

> This skill is self-contained. Support classes (`BaseRestfulApiServerEngine`,
> `BaseGetRenderer` / `BasePostRenderer`, `RestfulApiResponse`, `BaseRestfulApiContext` /
> `BaseRestfulApiShare`, `BaseRestfulApiResponseFlusher`) come from the framework
> (`@openreachtech/renchan`). Examples use generic entities (`Article`) and generic routes;
> substitute your own. Some conventions below are the **target** shape — where the current repo
> diverges (notably input validation, §5), the improved form is described.

## Core principle: a renderer is a resolver with an HTTP envelope

One request → one **renderer**. A renderer does the same job a GraphQL resolver does — validate,
touch the DB / an external system, shape a result — but it speaks HTTP:

- Its return value is a **`RestfulApiResponse`** (`statusCode` + `content` / `error`), not a bare
  object. Errors are **returned**, not thrown: `return this.errorResponseHash.Xxx.createAsError()`.
- It is bound to an **HTTP method + route** (`GET /v1/articles`), discovered from a **versioned
  directory** (`renderers/v1/get/…`), not from a schema name.
- Everything else — the per-request **context** (`now`, `share`, `env`, the authenticated user),
  the **error hash** declared up front, an optional **DI factory** — is the same idea as the
  GraphQL side.

Three rules matter most:

1. **Return responses, never throw.** Every exit is a `RestfulApiResponse` — success via
   `RestfulApiResponse.create({ statusCode, content })`, failure via
   `this.errorResponseHash.Xxx.createAsError()`. HTTP always needs a status code, so an error
   without one is meaningless here (§4).
2. **The engine owns cross-cutting concerns; the renderer owns one endpoint.** Auth (the visa
   filter), middleware, versioning, and the standard error envelopes live on the engine (§3). The
   renderer only knows its route, its errors, and its `render()` (§2).
3. **Validate at the boundary, then delegate.** REST input arrives split across `body` / `query` /
   path params and is all string-like; normalize and validate it before touching the DB (§5).

- **Comments: English for code, the surrounding language for domain notes.** Match the neighbors.

## Layer map

```
                        HTTP request
                             │
        ┌────────────────────▼─────────────────────┐
        │ Engine  (BaseRestfulApiServerEngine)      │  app-wide: routes, middleware,
        │  config: pathPrefix + renderersPath       │  auth filter (visa), Share/Context,
        │  generateFilterHandler(), visaIssuers     │  standardErrorEnvelopHash
        └────────────────────┬─────────────────────┘
                             │ builds per request
        ┌────────────────────▼─────────────────────┐
        │ Context (per request) + Share (per proc)  │  now, env, share, user,
        │  hasAuthenticated / hasAuthorized / …     │  hasPathPermission  (§3)
        └────────────────────┬─────────────────────┘
                             │ render input = { body, query, context, request }
        ┌────────────────────▼─────────────────────┐
        │ Renderer (BaseGetRenderer/BasePostRenderer)│  routePath, errorStructureHash,
        │  passesFilter, render() → RestfulApiResponse│  passesFilter, render()  (§1,§2)
        └────────────────────┬─────────────────────┘
                             │ returns RestfulApiResponse (status + content/error)  (§4)
        ┌────────────────────▼─────────────────────┐
        │ Flusher (BaseRestfulApiResponseFlusher)   │  writes status + headers + body
        │  Json (default) / Html / Csv / Redirect   │  contentType, flushResponseBody  (§4)
        └────────────────────┬─────────────────────┘
                             ▼
                        HTTP response
```

## Request lifecycle

For each incoming request the framework's routes builder:

1. Builds the **render input** `{ body, query, context, request }` — `body` is the multer-fulfilled
   request body, `query` is `expressRequest.query`, `context` is created async (resolves the user +
   visa), `request` wraps the express request (path-param proxy).
2. If the renderer's **`passesFilter`** is `true`, skips the filter; otherwise runs the engine's
   **filter handler** (auth). If the filter returns an error response, that short-circuits `render()`.
3. Calls **`renderer.render(input)`**, which returns a `RestfulApiResponse`.
4. Any **thrown** error is caught and converted to a `500` `RestfulApiResponse` (Unknown) — so
   renderers should still return their own typed errors rather than relying on this.
5. The renderer's **flusher** writes the response (status, headers, body).

## 1. Directory, versioning, and route binding

Renderers live under `server/restfulapi/renderers/`, split **by version then by HTTP method**:

```
server/restfulapi/
  AppRestfulApiServerEngine.js       # the engine (§3)
  contexts/
    AppRestfulApiContext.js          # per-request context (§3)
    AppRestfulApiShare.js            # per-process share (§3)
  flushers/                          # custom response flushers (§4)
  renderers/
    v1/
      get/   <Name>Renderer.js       # one file per endpoint
      post/  <Name>Renderer.js
    v2/
      get/   …
      post/  …
```

- **`renderers/<version>/<method>/<Name>Renderer.js`** — the directory encodes the **version**
  (`v1`, `v2`) and the **HTTP method** (`get`, `post`, …). Keep the method out of the class name and
  let the folder carry it (the repo has both `FooRenderer` and `FooGetRenderer` — prefer the
  folder-only form for new files).
- **The engine selects the version.** `config.renderersPath` points at **one** version directory
  (`renderers/v1/`) and `config.pathPrefix` (`/v1`) is prepended to every `routePath`. So
  `routePath = '/articles'` in `renderers/v1/get/` serves **`GET /v1/articles`**. Serve another
  version by pointing an engine at `renderers/v2/` with prefix `/v2`.
- **The route is `pathPrefix + routePath`, method = the renderer's `method`.** The framework
  discovers every renderer under `renderersPath`, reads its `routePath` and `method`, and registers
  the express route — you never wire routes by hand.

Detail in [renderers.md](./references/renderers.md).

## 2. The renderer

A renderer extends the method base (`BaseGetRenderer` / `BasePostRenderer` / `BasePutRenderer` / …)
and implements a small, fixed surface:

```js
import {
  BaseGetRenderer,
  RestfulApiResponse,
} from '@openreachtech/renchan'

export default class ArticleGetRenderer extends BaseGetRenderer {
  /** @override */
  static get routePath () {
    return '/articles'
  }

  /** @override */
  static get errorStructureHash () {
    return {
      ArticleNotFound: {
        statusCode: 404,
        errorMessage: 'Article not found',
      },
    }
  }

  /** @override */
  get passesFilter () {
    return true // public endpoint → skip the engine auth filter
  }

  /**
   * @override
   * @param {RestfulApiType.RenderInput<*, *>} input
   * @returns {Promise<RestfulApiType.RenderResponse>}
   */
  async render ({
    query,
    context,
    request,
  }) {
    const article = await this.findArticle({
      articleId: request.pathParameterHashProxy.articleId,
    })

    if (!article) {
      return this.errorResponseHash.ArticleNotFound.createAsError()
    }

    return RestfulApiResponse.create({
      statusCode: 200,
      content: this.formatResponseContent({
        article,
      }),
    })
  }

  // ... findArticle(), formatResponseContent() ...
}
```

- **`render({ body, query, context, request })`** is the entry point. `body` = parsed request body
  (POST/PUT/PATCH), `query` = query string params, `context` = the per-request context (`now`,
  `share`, `env`, user — §3), `request` = the wrapped express request (`expressRequest`, and a
  `pathParameterHashProxy` that returns `null` for missing path params).
- **`static get routePath()`** — the route (prefixed by the engine, §1).
- **`get passesFilter()`** — `true` skips the engine's auth filter (public); default `false` runs it.
- **Dependency injection** — add `constructor` + `static create()` + `static createXxx()` only when
  a tool must be substitutable in tests (same factory pattern as the GraphQL side).

Method-verb subclasses, `render()` input shape, DI, and file uploads (multer via
`fileFieldsConfigHash`) are in [renderers.md](./references/renderers.md).

## 3. Engine, context, and share (the app-wide layer)

These three set up the whole REST surface, mirroring the GraphQL engine/context/share:

- **Engine** (`AppRestfulApiServerEngine extends BaseRestfulApiServerEngine`) — declares `config`
  (`pathPrefix` / `renderersPath` / `staticPath`), wires `static get Share()` / `static get
  Context()`, the **`standardErrorEnvelopHash`** (cross-cutting errors: `Unknown`,
  `Unauthenticated`, `Unauthorized`, `Database`, …), the express **middleware**
  (`collectMiddleware()`), the **auth filter** (`generateFilterHandler()`), and the **visa issuers**
  (`visaIssuers`: `hasAuthenticated` / `hasAuthorized` / `hasPathPermission`).
- **Context** (`AppRestfulApiContext extends BaseRestfulApiContext`) — built per request. Override
  `static async findUser()` to resolve the authenticated user from the access-token header. Exposes
  `now`, `userId`, `userEntity`, `share`, `env`, and the visa predicates
  (`hasAuthenticated()` / `hasAuthorized()` / `hasPathPermission()`).
- **Share** (`AppRestfulApiShare extends BaseRestfulApiShare`) — the per-process object (holds `env`;
  put shared clients/providers here). Often a `// noop` subclass.

Detail in [engine-and-context.md](./references/engine-and-context.md).

## 4. Response, error hash, and flusher

- **`RestfulApiResponse`** is the return type. Success:
  `RestfulApiResponse.create({ statusCode, headers?, content })`. Error: from the built error hash,
  `this.errorResponseHash.Xxx.createAsError()`.
- **Error hash** — like the GraphQL error code hash, a renderer declares its errors up front in
  `static get errorStructureHash()`. **Unlike** GraphQL (code only), each REST entry also carries a
  `statusCode` and `errorMessage`, because an HTTP response needs a status. The framework turns the
  hash into constructable `RestfulApiResponse` subclasses on `this.errorResponseHash`. Cross-cutting
  errors live on the engine's `standardErrorEnvelopHash`.
- **Extending the response** — when you need a non-default body shape or behavior, subclass
  `RestfulApiResponse` in the app and return that.
- **Flusher** — a `BaseRestfulApiResponseFlusher` writes the response (status → headers → body).
  Default is JSON (`{ content, error }`); the framework also ships Html and Csv; a renderer selects
  one via `static get FlusherCtor()`, and the app can define custom flushers (e.g. a redirect).

Detail in [response-and-flusher.md](./references/response-and-flusher.md).

## 5. Input validation (the target shape)

The current repo validates REST input **ad hoc** inside `render()` (an inline `isValidRequestBody()`).
The **target** is to validate with the **same validator structure as GraphQL**: a
`BaseInputValidator` subclass whose `generateValidationEntries()` returns `[predicate, ErrorCtor]`
pairs and whose `validateInput()` returns the first failing error (or `null`).

The catch is the input shape. A GraphQL validator receives a single typed `input` object; REST input
arrives split across **`body` / `query` / path params**, all strings. So a REST renderer needs an
**adapter**: a small class that reads `{ body, query, request }` and produces the normalized `input`
object the validator expects. The renderer flow becomes **adapter → input → validator → (on failure)
map to the renderer's `errorResponseHash` entry**.

There is also a **type-mismatch** to bridge: a GraphQL-style validator yields a code-only error,
while REST needs a **status-bearing** `RestfulApiResponse`. The wiring must map each validation
failure to the matching `errorStructureHash` entry (status + message).

The adapter, the validator contract, and the error mapping are in
[validation.md](./references/validation.md).

## Detail files

- [renderers.md](./references/renderers.md) — the renderer file: method-verb subclasses, directory
  & versioning, `routePath`, `render()` input (`body` / `query` / `context` / `request`),
  `passesFilter`, the DI factory, and multipart file uploads (§1, §2)
- [engine-and-context.md](./references/engine-and-context.md) — the engine (`config`,
  `renderersPath` / `pathPrefix`, `Share` / `Context`, `standardErrorEnvelopHash`, middleware,
  filter handler, visa issuers) and the per-request context / per-process share (§3)
- [response-and-flusher.md](./references/response-and-flusher.md) — `RestfulApiResponse`
  (success / `createAsError`), `errorStructureHash` → `errorResponseHash`, extending the response,
  and flushers (JSON / Html / Csv / custom, `FlusherCtor`, `contentType`) (§4)
- [validation.md](./references/validation.md) — the target validator (`BaseInputValidator`,
  `generateValidationEntries`, `validateInput`), the REST-input → `input` adapter, and mapping a
  validation failure to a status-bearing response (§5)
