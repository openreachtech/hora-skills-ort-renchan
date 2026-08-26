# Input validation (the target shape)

The current repo validates REST input **ad hoc** inside `render()` — a hand-rolled
`isValidRequestBody()` per renderer. The **target** is to validate with the **same validator
structure the GraphQL layer uses**, so the two surfaces share one validation approach. Reaching
that needs two collaborators: an **adapter** that normalizes REST input, and a **validator** that
runs the rules.

> This page is a target design, not the current repo. Examples use a generic `Article` resource.

## Why validation needs an adapter here

A GraphQL validator receives a single, already-typed `input` object. REST input does not arrive that
way — it is **split across `body` / `query` / path params**, and it is all **string-like** (query
and path values are strings; body values are whatever the client sent). Before any rule can run, the
input has to be **collected and coerced** into the one `input` object the validator expects. That
collect-and-coerce step is the **adapter**.

So the boundary has two responsibilities, kept in two classes:

- **Adapter** — read `{ body, query, request }`, produce a normalized `input` object (coerce types,
  default missing values to `null`, merge the sources).
- **Validator** — take that `input` and decide whether each value is acceptable.

## The validator (same structure as GraphQL)

A validator extends the shared **`BaseInputValidator`** and overrides one method:
`generateValidationEntries()`, which returns an array of **`[predicate, ErrorIdentity]`** pairs. The
base's `validateInput()` runs the predicates in order and returns the **first failing** entry's error
(or `null` when all pass). Predicates are small `isValidX()` methods that read `this.input` and
return a boolean — they never throw.

```js
import BaseInputValidator from '../../BaseInputValidator.js'

export default class CreateArticleInputValidator extends BaseInputValidator {
  /**
   * @override
   * @returns {Array<[() => boolean, *]>}
   */
  generateValidationEntries () {
    return [
      [
        () => this.isValidTitle(),
        this.errorHash.InvalidTitle,
      ],
      [
        () => this.isValidTagIds(),
        this.errorHash.InvalidTagIds,
      ],
    ]
  }

  /**
   * @returns {boolean}
   */
  isValidTitle () {
    const {
      title,
    } = this.input

    return typeof title === 'string'
      && title.length > 0
  }

  /**
   * @returns {boolean}
   */
  isValidTagIds () {
    const {
      tagIds,
    } = this.input

    return Array.isArray(tagIds)
      && tagIds.every(id => Number.isInteger(id))
  }
}
```

This is the **same shape** the GraphQL side uses — `generateValidationEntries()` returning
`[predicate, error]` pairs, `validateInput()` provided by the base. Only the input it validates
differs, and that difference is absorbed by the adapter.

## The adapter

One adapter per operation. It reads the three REST sources and returns the normalized `input`.

```js
export default class CreateArticleInputAdapter {
  /**
   * @param {{
   *   body: RestfulApiType.RenderRequestBody
   *   query: RestfulApiType.RenderRequestQuery
   *   request: RestfulApiType.Request
   * }} params
   * @returns {CreateArticleInputAdapter}
   */
  static create ({
    body,
    query,
    request,
  }) {
    return new this({
      body,
      query,
      request,
    })
  }

  /**
   * @param {{
   *   body: RestfulApiType.RenderRequestBody
   *   query: RestfulApiType.RenderRequestQuery
   *   request: RestfulApiType.Request
   * }} params
   */
  constructor ({
    body,
    query,
    request,
  }) {
    this.body = body
    this.query = query
    this.request = request
  }

  /**
   * Normalize REST input into the validator's `input` shape.
   *
   * @returns {{
   *   title: string | null
   *   tagIds: Array<number>
   *   articleId: number | null
   * }}
   */
  buildInput () {
    return {
      title: this.body.title ?? null,
      tagIds: this.extractTagIds(),
      articleId: this.extractArticleId(),
    }
  }

  /**
   * Coerce a comma-joined query string into a number array.
   *
   * @returns {Array<number>}
   */
  extractTagIds () {
    const raw = this.query.tagIds ?? ''

    return raw
      .split(',')
      .filter(Boolean)
      .map(Number)
  }

  /**
   * Coerce the path parameter into a number.
   *
   * @returns {number | null}
   */
  extractArticleId () {
    const raw = this.request.pathParameterHashProxy.articleId

    return raw === null
      ? null
      : Number(raw)
  }
}
```

- The adapter is the **only** place that knows input was split across sources and arrived as strings.
  Everything downstream sees a clean, typed `input`.

## Wiring in the renderer (and the error-type bridge)

The renderer runs **adapter → validator → (on failure) a status-bearing response**:

```js
async render ({
  body,
  query,
  request,
}) {
  const input = CreateArticleInputAdapter.create({
    body,
    query,
    request,
  })
    .buildInput()

  const validationResult = this.validateInput({
    input,
  })

  if (validationResult) {
    return validationResult
  }

  // ... input is now trusted; touch the DB, return RestfulApiResponse ...
}
```

There is one bridge to get right. A GraphQL-style validator yields a **code-only** error, but REST
must return a **status-bearing `RestfulApiResponse`** (§4). Resolve it one of two ways:

- **Map in the renderer (recommended).** Keep `BaseInputValidator` transport-neutral: its
  `errorHash` entries are error **identities** (names/keys), `validateInput()` returns the failing
  identity or `null`, and the renderer maps that identity to its own
  `this.errorResponseHash.Xxx.createAsError()`. The validator stays byte-for-byte the same as the
  GraphQL one; only the renderer knows about HTTP status.
- **A REST base validator.** Alternatively, a thin `BaseRestfulApiInputValidator` overrides how the
  failing entry is instantiated so it returns a `RestfulApiResponse` (via `createAsError()`) directly,
  and you feed it the renderer's `errorResponseHash`. Use this if you would rather the validator emit
  the final response.

Either way, keep `createInputValidator()` / `validateInput()` as thin named methods on the renderer,
mirroring the GraphQL side, so the two surfaces read the same.

## Split of duty

- **Adapter** — shape and type only: collect `body` / `query` / path, coerce strings, default to
  `null`. No value judgements.
- **Validator** — value rules on the normalized `input`: presence, format, ranges, enums. Pure
  booleans; no DB.
- **Renderer / DB layer** — existence, ownership, and state checks that require the database (a
  missing row → return a `404`-class response). These stay out of the validator, exactly as on the
  GraphQL side.
