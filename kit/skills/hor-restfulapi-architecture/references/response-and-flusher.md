# Response, error hash, and flusher

A renderer always returns a **`RestfulApiResponse`** — an HTTP envelope carrying a `statusCode` plus
`content` (success) or `error` (failure). A **flusher** then writes that envelope to the express
response. This file covers both, and the error hash that produces error responses.

## RestfulApiResponse

`RestfulApiResponse` holds `{ statusCode, headers, content, error }`.

```js
// success
return RestfulApiResponse.create({
  statusCode: 200,
  content: {
    articleId: article.id,
  },
})
```

- **Success** → `RestfulApiResponse.create({ statusCode, headers?, content })`. `content` is the
  response payload; `error` stays `null`.
- **Failure** → **do not** `new` an error response by hand; take it from the built error hash:
  `this.errorResponseHash.Xxx.createAsError()` (below). `createAsError()` fills in the entry's
  `statusCode` and wraps the message as `{ error: { message } }`.
- `get status()` aliases `statusCode` (the flusher reads `renderResponse.status`).

## Error hash: `errorStructureHash` → `errorResponseHash`

Like the GraphQL error code hash, a renderer declares every error it can return **up front**. The
difference: **each REST entry carries a `statusCode` and `errorMessage`**, because an HTTP response
needs a status — a code alone is not enough.

```js
/** @override */
static get errorStructureHash () {
  return {
    InvalidRequestBody: {
      statusCode: 400,
      errorMessage: 'Invalid request body',
    },
    ArticleNotFound: {
      statusCode: 404,
      errorMessage: 'Article not found',
    },
  }
}
```

- The framework's `buildErrorResponseHash()` turns each `{ Name: { statusCode, errorMessage } }`
  entry into a constructable `RestfulApiResponse` subclass on **`this.errorResponseHash`** (also
  reachable as `this.Error`). Return one with `this.errorResponseHash.ArticleNotFound.createAsError()`.
- **Naming = the reason** (`InvalidRequestBody`, `ArticleNotFound`) — read as a sentence at the
  return site. No `info` / `data` suffixes.
- **Cross-cutting** errors (`Unauthenticated`, `Unauthorized`, `Unknown`, `Database`) are declared
  **once on the engine** (`standardErrorEnvelopHash`) and used by the auth filter — do not redeclare
  them per renderer. See [engine-and-context.md](./engine-and-context.md).

This is the REST analog of "declare errors as a hash, throw by name" — here you **return** by name,
and each name resolves to a status-bearing response.

## Extending RestfulApiResponse

When the default envelope is not enough — a custom body shape, extra headers, a computed status —
subclass `RestfulApiResponse` in the app and return that subclass. Override what you need (e.g. a
fixed `statusCode` getter, or an added factory) while keeping the `{ statusCode, content, error }`
contract the flusher relies on. Prefer extending over hand-building one-off response objects, so
every endpoint returns the same recognizable shape.

## Flushers

A **flusher** (`BaseRestfulApiResponseFlusher` subclass) writes the `RestfulApiResponse` to express:
status → headers → body. The renderer picks one via `static get FlusherCtor()`.

| Flusher | contentType | body |
| --- | --- | --- |
| `JsonRestfulApiResponseFlusher` (default) | `application/json` | `{ content, error }` |
| `HtmlRestfulApiResponseFlusher` | `text/html` | HTML string |
| `CsvRestfulApiResponseFlusher` | `text/csv` | CSV |
| app custom (e.g. a redirect flusher) | your choice | your choice |

- **Default is JSON** — a renderer that returns JSON needs no `FlusherCtor` override.
- **Select a non-default flusher** per renderer:

```js
/** @override */
static get FlusherCtor () {
  return HtmlRestfulApiResponseFlusher
}
```

- **Write a custom flusher** by extending `BaseRestfulApiResponseFlusher`: set `static get
  contentType()` and implement `flushResponseBody()` (or override `flushResponse()` entirely for
  non-body responses like a redirect). It reads `this.renderResponse` (the `RestfulApiResponse`) and
  `this.expressResponse`:

```js
import {
  BaseRestfulApiResponseFlusher,
} from '@openreachtech/renchan'

export default class RedirectRestfulApiResponseFlusher extends BaseRestfulApiResponseFlusher {
  /** @override */
  static get contentType () {
    return 'text/html'
  }

  /** @override */
  flushResponse () {
    this.expressResponse.redirect(
      this.renderResponse.status,
      this.renderResponse.content?.redirectUrl ?? '/'
    )
  }
}
```

Place app flushers under `server/restfulapi/flushers/`.
