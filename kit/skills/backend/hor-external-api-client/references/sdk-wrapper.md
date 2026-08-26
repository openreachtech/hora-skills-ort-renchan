# The SDK-wrapping pattern (an interim implementation)

What to do when the vendor publishes an official SDK (`@google/genai`, the AWS SDK, …). Rather than
hitting HTTP directly, **the launcher holds the SDK** and calls it. The way differences are absorbed
(input in the `Payload`, output in the `Capsule`) is the same as in the direct-HTTP pattern; **only the
transport step changes, from `fetch` to an SDK call**. Referenced from [SKILL.md](../SKILL.md). Direct
HTTP is in [launcher.md](./launcher.md).

## ⚠️ This is interim. Migrate once it is supported properly

rocket-client does **not support** the SDK-wrapping shape at present. This section is a **temporary
workaround that overrides `BaseLauncher.launchRequest()`** — the `fetch` flow — and substitutes an SDK
call.

- Migrate as soon as an update supports it properly.
- **Keep it minimal, because it is interim** — add extensions such as holding the error only when you
  actually need them.
- **Limit where it is used**: only where an official SDK is provided. If REST can be hit directly, use
  the direct-HTTP pattern and do not override `launchRequest()`.
- The existing `app/geminiClient/` is an SDK wrapper of the same kind.

## Launcher: hold the SDK and override `launchRequest()`

- Extend `constructor` / `create()` to hold the SDK instance. Produce the default from a factory
  (`createSdkClient()`) so that **a test can swap it with `create({ sdkClient })`**.
- Override `launchRequest()` so that instead of the `fetch` flow (`createFetchRequest` → `fetch` → JSON
  parsing), it **calls the SDK method and builds the `Capsule` straight from the result**.
- The raw object the SDK returns (the one with getters like `.text`) is **stored in `rawResponse` without
  going through schema normalization**. The `Capsule` reads it from `this.rawResponse` directly.
- Keep calling the input validation (`hasInvalidParameterHash()`) after the override, and on invalid
  input return an error `Capsule` without calling the SDK. When the SDK call throws, return a `Capsule`
  with `rawResponse: null` so that `hasError()` is `true`.
- **Why make it injectable**: the SDK really does perform the external communication, so a test cannot
  call the real one. Only with `create({ sdkClient })` can the launcher's behaviour be verified against a
  stub SDK ([testing.md](./testing.md)).

```js
import {
  GoogleGenAI,
} from '@google/genai'

import {
  env,
} from '../globals/_.js'

import {
  BaseLauncher,
} from '@openreachtech/mentsu-rocket-client'

import SendMessageToGeminiPayload from './SendMessageToGeminiPayload.js'
import SendMessageToGeminiCapsule from './SendMessageToGeminiCapsule.js'

export default class SendMessageToGeminiLauncher extends BaseLauncher {
  /**
   * Constructor.
   *
   * @param {{
   *   config: Record<string, *>
   *   sdkClient: import('@google/genai').GoogleGenAI
   * }} params
   */
  constructor ({
    config,
    sdkClient,
  }) {
    super({
      config,
    })

    this.sdkClient = sdkClient
  }

  /**
   * Factory method.
   *
   * @override
   * @param {{
   *   config?: Record<string, *>
   *   sdkClient?: import('@google/genai').GoogleGenAI
   * }} [params]
   * @returns {SendMessageToGeminiLauncher}
   */
  static create ({
    config = this.clientConfig,
    sdkClient = this.createSdkClient({
      config,
    }),
  } = {}) {
    return new this({
      config,
      sdkClient,
    })
  }

  /**
   * get: client configuration.
   *
   * @override
   * @returns {{
   *   LLM_API_KEY: string
   * }}
   */
  static get clientConfig () {
    return {
      LLM_API_KEY: env.LLM_API_KEY,
    }
  }

  /** @override */
  static get Payload () {
    return SendMessageToGeminiPayload
  }

  /** @override */
  static get Capsule () {
    return SendMessageToGeminiCapsule
  }

  /**
   * Create the vendor SDK client (transport).
   *
   * @param {{
   *   config: {
   *     LLM_API_KEY: string
   *   }
   * }} params
   * @returns {import('@google/genai').GoogleGenAI}
   */
  static createSdkClient ({
    config,
  }) {
    return new GoogleGenAI({
      apiKey: config.LLM_API_KEY,
    })
  }

  /**
   * Launch request via the SDK (provisional override of the fetch flow).
   *
   * @override
   * @param {{
   *   payload: SendMessageToGeminiPayload
   * }} params
   * @returns {Promise<SendMessageToGeminiCapsule>}
   */
  async launchRequest ({
    payload,
  }) {
    if (payload.hasInvalidParameterHash()) {
      return this.Ctor.createCapsuleAsInvalidInputError({
        payload,
      })
    }

    try {
      const result = await this.sdkClient
        .models
        .generateContent(
          payload.toSdkParams()
        )

      return this.Ctor.createCapsule({
        payload,
        rawResponse: result,
        rawBody: null,
      })
    } catch (error) {
      return this.Ctor.createCapsule({
        payload,
        rawResponse: null,
        rawBody: null,
      })
    }
  }
}
```

## Payload: still extends `BasePayload`, as a container with `toSdkParams()`

Even for an SDK call the `Payload` extends `BasePayload`, because `Capsule`'s `hasError()` and friends
consult the payload's `hasAuthorization()` / `hasInvalidParameterHash()`. The parameters for the SDK call
are returned from `toSdkParams()`.

- `method` / `pathname` / `contentType` are unused by an SDK call, but `BasePayload.create()` consults
  them, so they are still declared (interim).
- **Why extend `BasePayload`**: to keep the same split of responsibilities in an SDK wrapper — input
  validation in the payload, extraction in the capsule. Drop the inheritance for a plain object and the
  payload interface that `Capsule.hasError()` assumes is missing, and it breaks.

```js
import {
  KeywordScalar,
} from '@openreachtech/mentsu-schema'

import {
  BasePayload,
  REST_METHOD,
} from '@openreachtech/mentsu-rocket-client'

export default class SendMessageToGeminiPayload extends BasePayload {
  /** @type {Record<string, *>} */
  static bodySchema = {
    model: KeywordScalar,
  }

  // Interim: unused by the SDK call, but declared because BasePayload.create() consults it.
  /** @override */
  static get method () {
    return REST_METHOD.POST
  }

  /** @override */
  static get pathname () {
    return '/'
  }

  /** @override */
  static get contentType () {
    return 'application/json'
  }

  /**
   * SDK params.
   *
   * @returns {Record<string, *>}
   */
  toSdkParams () {
    return this.requestBody.body
  }
}
```

The caller passes the SDK parameters as `body`:

```js
const payload = SendMessageToGeminiPayload.create({
  body: {
    model: 'gemini-2.5-flash',
    contents: 'fake-contents-001',
  },
})
```

## Capsule: extract from `this.rawResponse` (the SDK object)

In an SDK wrapper, `extractXxx()` reads not the JSON-normalized `this.body` but `this.rawResponse` — the
raw object the SDK returns, with getters like `.text`. The conventions for null guards and defaults are
the same as for direct HTTP ([capsule.md](./capsule.md)).

```js
import {
  BaseCapsule,
} from '@openreachtech/mentsu-rocket-client'

/**
 * @extends {BaseCapsule<*, *>}
 */
export default class SendMessageToGeminiCapsule extends BaseCapsule {
  /**
   * Extract content text from the SDK response.
   *
   * @returns {string}
   */
  extractContentText () {
    return this.rawResponse?.text
      ?? ''
  }

  /**
   * Extract function calls from the SDK response.
   *
   * @returns {Array<{
   *   name: string
   *   arguments: object
   * }>}
   */
  extractFunctionCalls () {
    return this.rawResponse?.functionCalls
      ?.map(functionCall => ({
        name: functionCall.name,
        arguments: functionCall.args,
      }))
      ?? []
  }
}
```

- When the SDK call throws, `launchRequest()` returns a `Capsule` with `rawResponse: null` — the
  equivalent of a network error — so `capsule.hasError()` is `true`. Pulling out the SDK's error message
  and the like needs an extension, such as adding a factory to the `Capsule` that holds the error; keep
  it minimal while this is interim.
