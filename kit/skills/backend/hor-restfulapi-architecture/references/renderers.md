# The renderer file

A renderer resolves one HTTP endpoint. It extends a **method-verb base** and implements a fixed
surface: the route, the errors it can return, whether it skips the auth filter, and `render()`.

> Examples use a generic `Article` resource. Swap in your own.

## Method-verb subclasses

Extend the base for the HTTP method the endpoint answers. The base fixes `static get method()`:

| Base class | method | Notes |
| --- | --- | --- |
| `BaseGetRenderer` | `get` | no request body |
| `BasePostRenderer` | `post` | body-bearing (multer middleware, file uploads) |
| `BasePutRenderer` | `put` | body-bearing |
| `BasePatchRenderer` | `patch` | body-bearing |
| `BaseDeleteRenderer` | `delete` | |
| `BaseHeadRenderer` / `BaseOptionsRenderer` / … | head / options / … | |

Body-bearing verbs (post/put/patch) extend a request-body base that wires **multer** for
`multipart/form-data`; the rest extend the plain renderer base directly. All ultimately extend
`BaseRenderer`, which holds the factory, the error hash, and `flushResponse()`.

## Directory & versioning

One renderer = one file (one class per file):

```
server/restfulapi/renderers/<version>/<method>/<Name>Renderer.js
  e.g. server/restfulapi/renderers/v1/get/ArticleGetRenderer.js
       server/restfulapi/renderers/v1/post/CreateArticleRenderer.js
```

- The **folder encodes version and method** — the framework reads each renderer's `routePath` and
  `method` and registers the express route under `config.pathPrefix`. You never wire routes by hand.
- **Class name** = `<Name>Renderer` (PascalCase). Let the `get/` `post/` folder carry the verb rather
  than repeating it in the name.
- A new API **version** is a new directory (`renderers/v2/`) served by an engine pointed at it with
  its own `pathPrefix` (`/v2`). See [engine-and-context.md](./engine-and-context.md).

## The fixed surface

```js
import {
  BasePostRenderer,
  RestfulApiResponse,
} from '@openreachtech/renchan'

import Article from '../../../../../sequelize/models/Article.js'

export default class CreateArticleRenderer extends BasePostRenderer {
  /**
   * get: Route path.
   *
   * @override
   * @returns {string}
   */
  static get routePath () {
    return '/articles'
  }

  /**
   * get: Error structure hash.
   *
   * @override
   * @returns {Record<string, RestfulApiType.ErrorResponseEnvelope>}
   */
  static get errorStructureHash () {
    return {
      InvalidRequestBody: {
        statusCode: 400,
        errorMessage: 'Invalid request body',
      },
    }
  }

  /**
   * get: Passes filter.
   *
   * @override
   * @returns {boolean}
   */
  get passesFilter () {
    return false // run the engine auth filter before render
  }

  /**
   * Render.
   *
   * @override
   * @param {RestfulApiType.RenderInput<*, *>} input
   * @returns {Promise<RestfulApiType.RenderResponse>}
   */
  async render ({
    body,
    context: {
      now,
      userId,
    },
  }) {
    if (!this.isValidBody({
      body,
    })) {
      return this.errorResponseHash.InvalidRequestBody.createAsError()
    }

    const article = await this.saveArticle({
      body,
      now,
      userId,
    })

    return RestfulApiResponse.create({
      statusCode: 201,
      content: {
        articleId: article.id,
      },
    })
  }

  // ... isValidBody(), saveArticle() ...
}
```

- **`static get routePath()`** — the route, prefixed by the engine (`/articles` → `/v1/articles`).
- **`static get errorStructureHash()`** — the errors this renderer can return, each with a
  `statusCode` + `errorMessage`. See [response-and-flusher.md](./response-and-flusher.md).
- **`get passesFilter()`** — `true` = public (skip the engine auth filter); default `false` = run it.
- **`async render(input)`** — the entry point (below).

## `render()` input: `{ body, query, context, request }`

The framework passes one object with four keys:

- **`body`** — the parsed request body (POST/PUT/PATCH). For `multipart/form-data`, multer has
  already run and files are attached (see file uploads below).
- **`query`** — `expressRequest.query` (the query-string params, all strings).
- **`context`** — the per-request context: `now`, `share`, `env`, `userId` / `userEntity`, and the
  visa predicates. See [engine-and-context.md](./engine-and-context.md).
- **`request`** — the wrapped express request. `request.expressRequest` is the raw request;
  `request.pathParameterHashProxy` reads path params (`/articles/:articleId`) and returns **`null`**
  for a missing key rather than `undefined`.

Destructure only what the endpoint needs. `render()` must **return a `RestfulApiResponse`** on every
path — success via `RestfulApiResponse.create(...)`, failure via
`this.errorResponseHash.Xxx.createAsError()`. Do not throw (a thrown error becomes a generic 500).

## Dependency injection (optional)

Like a GraphQL resolver, a renderer needs no constructor unless it depends on a tool that tests must
substitute (a token/id generator, an external client). Then add the factory triple — and pass the
error hash through:

```js
constructor ({
  randomTextGenerator,
  errorResponseHash,
}) {
  super({
    errorResponseHash,
  })

  this.randomTextGenerator = randomTextGenerator
}

static create ({
  randomTextGenerator = this.createRandomTextGenerator(),
  errorStructureHash = this.errorStructureHash,
} = {}) {
  const errorResponseHash = this.buildErrorResponseHash({
    errorStructureHash,
  })

  return new this({
    randomTextGenerator,
    errorResponseHash,
  })
}

static createRandomTextGenerator () {
  return RandomTextGenerator.create()
}
```

- Note the base's `create()` builds `errorResponseHash` from `errorStructureHash` via
  `buildErrorResponseHash()`. When you override `create()`, do that build yourself and pass
  `errorResponseHash` to `super()` — never drop it.

## File uploads (body-bearing renderers)

A body-bearing renderer (post/put/patch) declares the multipart file fields it accepts via
`static get fileFieldsConfigHash()` — `{ <fieldName>: <maxCount> }`. The base builds the multer
middleware from it; with an empty hash multer runs in `.none()` mode (parses fields, no files).

```js
static get fileFieldsConfigHash () {
  return {
    attachment: 1,
  }
}
```

Uploaded files are attached to the request and merged into `body` before `render()` runs.
