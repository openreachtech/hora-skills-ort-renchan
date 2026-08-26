# Usage (the implementation steps, and use from the caller)

The steps for adding a new API operation, and how a caller such as a resolver or a job (an
ActionExecuter) uses it. Referenced from [SKILL.md](../SKILL.md). Each layer is detailed in
[launcher.md](./launcher.md) / [payload.md](./payload.md) / [capsule.md](./capsule.md) /
[authorization.md](./authorization.md).

## Implementation steps

Start from **step 0** when the external service itself does not exist yet, or from **step 1** when
adding an operation to a service that does.

### Step 0: lay the groundwork for the service (once per service)

1. Create the `app/<serviceName>Client/` directory.
2. Create the **base launcher** (`Base<Service>Launcher.js`): extend `BaseLauncher` and implement
   `clientConfig`, taking the base URL from an environment variable
   ([launcher.md](./launcher.md#base-launcher-one-per-service-holding-clientconfig)).
3. Add the environment variables for the base URL, credentials and so on to `.env.*`
   (e.g. `DOCUMENT_API_BASE_URL`, `DOCUMENT_API_TOKEN`).

### Step 1: read the API spec

Establish the endpoint (method and path), the required and optional parameters (path / query / body),
the response shape, the authentication scheme and the content type. **The differences you find here are
exactly what gets confined to `Payload` / `Capsule`.**

### Step 2: write the payload ([payload.md](./payload.md))

1. Implement `method` and `pathname` (variable parts as `[placeholder]`), plus `contentType` for a
   method with a body.
2. Declare in `querySchema` / `bodySchema` only the keys that need conversion or validation.
3. When the outgoing keys are snake_case, swap `RequestQueryCtor` / `RequestBodyCtor` for the Snake
   ones.
4. When authentication is required, implement `AuthorizationBuilderCtor` / `authorizationApiKey`
   ([authorization.md](./authorization.md)).
5. Define the input types with `@typedef`.

### Step 3: write the capsule ([capsule.md](./capsule.md))

1. When the response is snake_case, swap `ResponseBodyCtor` for `CamelCasedKeyResponseBody`.
2. Work out which values you need out, and implement `extractXxx()` for each with a null guard
   (`null` / an empty array when missing).

### Step 4: write the derived launcher ([launcher.md](./launcher.md#derived-launcher-one-per-api-operation-tying-payload--capsule-together))

1. Extend the base launcher.
2. Return step 2's payload from `static get Payload ()` and step 3's capsule from
   `static get Capsule ()`.

### Step 5: write the tests

Write unit tests for the `Payload`, the `Capsule` and the `Launcher` ([testing.md](./testing.md)).

## Use from the caller (three steps)

From a resolver or a job, there are three steps.

1. Build the launcher with `Launcher.create()` (the connection settings are assembled from
   `clientConfig`).
2. Build the payload with `Launcher.createPayload({ ... })` and call
   `launcher.launchRequest({ payload })`.
3. Check `hasError()` on the returned `Capsule`, and pull values out with `extractXxx()`.

```js
import CreateDocumentLauncher from '../../../../../../app/documentApiClient/CreateDocumentLauncher.js'

export default class SomeResolver {
  /**
   * Create document launcher (factory for DI).
   *
   * @returns {CreateDocumentLauncher}
   */
  static createDocumentLauncher () {
    return CreateDocumentLauncher.create()
  }

  /**
   * Create a document via the external API.
   *
   * @param {{
   *   projectId: string
   *   title: string
   *   bodyText: string
   * }} params
   * @returns {Promise<{
   *   hasError: boolean
   *   documentId: string | null
   * }>}
   */
  async createDocument ({
    projectId,
    title,
    bodyText,
  }) {
    const payload = CreateDocumentLauncher.createPayload({
      pathParameterHash: {
        projectId,
      },
      body: {
        title,
        bodyText,
      },
    })

    const capsule = await this.documentApiLauncher.launchRequest({
      payload,
    })

    return {
      hasError: Boolean(capsule.hasError()),
      documentId: capsule.extractDocumentId(),
    }
  }
}
```

- The caller assembles in camelCase (`bodyText`) and pulls the value out with `extractDocumentId()` —
  nothing more. **It knows nothing of the external API's snake_case or of the response's nesting.** That
  is what confinement looks like when it is working
  ([SKILL.md](../SKILL.md#first-principle-confine-every-difference-from-the-external-api-to-payload--capsule-anti-corruption-layer)).

## The caller writes no `try-catch`

`launchRequest()` catches `fetch` exceptions and parse failures internally and converts them into an
error `Capsule`, so the caller decides failure with `capsule.hasError()` rather than `try-catch`
([SKILL.md](../SKILL.md#decide-failure-with-capsulehaserror-not-try-catch)).

```js
// Bad: handling errors through two channels, try-catch and the Capsule (a case falls through)
try {
  const capsule = await launcher.launchRequest({ payload })
  return capsule.extractDocumentId()
} catch (error) {
  // launchRequest never lands here. This catch is dead
}
```

## DI: inject a stub launcher

Let the class receive the launcher through its `constructor` / `create()`, and use a factory method such
as `create<Service>Launcher()` as the default. A test can then inject a stub launcher.

- **Why**: a launcher really does hit the external API, so a test cannot call the real one. With DI
  through a factory, the test gets the stub and production gets the real thing, without the caller
  changing.

## Hooks (optional): run something before or after sending

Use `launchRequest({ payload, hooks: { beforeRequest, afterRequest } })`. When
`beforeRequest(payload)` returns `true`, sending is stopped and the aborted-by-hooks `Capsule` is
returned.
