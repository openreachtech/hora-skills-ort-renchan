# Testing (tests for Payload / Capsule / Launcher)

The unit-test conventions for an external API client. The files live under
`tests/__tests__/app/<serviceName>Client/`, one per class. The general Jest conventions come from the
`hc-jest` skill; this file states only what is specific to this module. Referenced from
[SKILL.md](../SKILL.md).

- Use `test.each()`, and make the test data unique with explicit fake values (`fake-...`).
- **Always stub the external communication**: replace `fetch` for direct HTTP, or `sdkClient` for an
  SDK wrapper. Never write a test that hits the real thing (the mocking conventions of the `hc-jest`
  skill).

## What to test on a payload

- That it extends `BasePayload` (inheritance).
- That `method` / `pathname` / `contentType` are correct.
- That `querySchema` / `bodySchema` hold the expected keys.
- That the authentication members (`AuthorizationBuilderCtor` / `authorizationApiKey`) are correct.
- That after `create(...)`, `hasInvalidParameterHash()` is what it should be (`true` when a path
  parameter is missing).
- **Why test the validation too**: the payload's responsibility is to absorb the input differences and
  reject invalid input before sending. Without asserting the schema keys and
  `hasInvalidParameterHash()`, there is no signal when that absorption breaks.

## What to test on a capsule

- That it extends `BaseCapsule`.
- For each `extractXxx()`, split "the value is present" and "the value is absent (returns the default /
  `null`)" into separate `describe` blocks. Build one with
  `Capsule.create({ rawResponse, payload, rawBody })`.
- That `hasError()` is `true` for a status code (>= 400), a network error and an input error.
- **Why the absent case is mandatory**: the null guard and the default in `extractXxx()`
  ([capsule.md](./capsule.md#extractxxx-always-guards-against-null-and-returns-null--an-empty-array-when-the-value-is-missing))
  only matter when the response is missing something. Asserting only the present case lets a missing guard through —
  `body` is `null` and it throws a `TypeError`.

## What to test on a launcher

- That the base launcher extends `BaseLauncher`, and that `clientConfig` returns the expected
  connection settings.
- That the derived launcher's `Payload` / `Capsule` return the right classes.
- That `launchRequest()`, with **`fetch` stubbed** (by replacing `static get fetch ()`), is called with
  the correct `Request` (URL, method, headers, body) and returns a `Capsule`.
- For an SDK wrapper ([sdk-wrapper.md](./sdk-wrapper.md)), inject a stub SDK through
  `create({ sdkClient })` and assert that `launchRequest()` calls the SDK method with the right
  arguments and returns the result carried in a `Capsule`.

## Replace `fetch` by overriding it in a sub-class

Stub `fetch` by creating an anonymous class inside the test that extends `CreateDocumentLauncher` and
overrides `static get fetch ()`. Have `jest.fn().mockResolvedValue(...)` return a `Response`, then assert
that it was called and what the `Capsule` extracted.

```js
import CreateDocumentLauncher from '../../../../app/documentApiClient/CreateDocumentLauncher.js'
import CreateDocumentPayload from '../../../../app/documentApiClient/CreateDocumentPayload.js'
import CreateDocumentCapsule from '../../../../app/documentApiClient/CreateDocumentCapsule.js'

describe('CreateDocumentLauncher', () => {
  describe('.get:Payload', () => {
    test('to be CreateDocumentPayload', () => {
      expect(CreateDocumentLauncher.Payload)
        .toBe(CreateDocumentPayload)
    })
  })

  describe('.get:Capsule', () => {
    test('to be CreateDocumentCapsule', () => {
      expect(CreateDocumentLauncher.Capsule)
        .toBe(CreateDocumentCapsule)
    })
  })

  describe('#launchRequest()', () => {
    const cases = [
      {
        params: {
          pathParameterHash: {
            projectId: 'fake-project-id-001',
          },
          body: {
            title: 'fake-title-001',
            bodyText: 'fake-body-001',
          },
        },
      },
    ]

    test.each(cases)('projectId: $params.pathParameterHash.projectId', async ({
      params,
    }) => {
      const responseTally = new Response(
        JSON.stringify({
          document_id: 'fake-document-id-001',
        }),
        {
          status: 200,
        }
      )
      const fetchSpy = jest.fn()
        .mockResolvedValue(responseTally)

      const SpyLauncher = class extends CreateDocumentLauncher {
        /** @override */
        static get fetch () {
          return fetchSpy
        }
      }

      const launcher = SpyLauncher.create()

      const payload = SpyLauncher.createPayload(params)

      const capsule = await launcher.launchRequest({
        payload,
      })

      expect(fetchSpy)
        .toHaveBeenCalled()
      expect(capsule.extractDocumentId())
        .toBe('fake-document-id-001')
    })
  })
})
```

- Build the stub `Response` in **the external API's raw shape** (snake_case `document_id`) and assert all
  the way through that `extractDocumentId()` returns the value in our own terms
  (`fake-document-id-001`). That is how you confirm the whole chain of difference absorption —
  incoming key conversion, then extraction — is working.
