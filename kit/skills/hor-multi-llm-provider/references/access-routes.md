# Access routes (loader, route rows, authentication per route)

Referenced from `SKILL.md`. A route is how a request reaches a model and how it authenticates. The model
stays the same across routes; only the client, the credentials and the vendor model id change.

## Loader

`BulkAiAccessRoutesLoader` mirrors `BulkAiModelProcessorsLoader`: it auto-discovers every class under
`app/tools/AiAccessRoute/` with `DeepBulkClassLoader`, instantiates each via `.create()`, and matches on
the pair `(aiProviderId, accessRouteName)`:

```js
getRoute ({ aiProviderId, accessRouteName }) {
  return this.routes.find(route =>
    route.aiProviderId === aiProviderId
    && route.accessRouteName === accessRouteName
  )
}
```

`BaseAiAccessRoute` itself is skipped by discovery the same way `BaseAiModelProcessor` is.

## Route rows

`AiModelAccessRoute` holds one row per model and route the model is reachable through. The same model has
a different `targetModelName` on each route:

| `AiModel.name` | `accessRouteName` | `targetModelName` shape | `isDefault` |
| --- | --- | --- | --- |
| `sonnet-4-5` | `direct` | `claude-sonnet-4-5-20250929` | true |

Swapping the route for a model is a data change: flip `isDefault` between its rows. Disabling a route is
`isActive: false`. A model with no rows uses `direct` and `AiModel.targetModelName`.

## The direct route

The vendor's own API, authenticated by one API key per provider.

| Provider | Route class | Credentials (env) |
| --- | --- | --- |
| Anthropic | `ClaudeDirectAiAccessRoute` | `CLAUDE_API_TOKEN`, `CLAUDE_API_BASE_URL` |
| Google | `GeminiDirectAiAccessRoute` | the Gemini key and base URL vars |
| OpenAI | `OpenAiDirectAiAccessRoute` | the OpenAI key and base URL vars |

- `supportsFileUpload` is `true`: this is the route the Files API upload in `#prepareAttachedFiles()`
  was written for.
- `#createClient()` returns the existing `ClaudeApiClient` / Gemini / OpenAI client, so a deployment that
  only uses this route behaves exactly as before the routes existed.

## The Vertex AI route (service account)

Models hosted on Google Cloud, reached with a **service account**, never an API key. There is no key
variable to read: the client resolves Application Default Credentials (ADC) itself.

| Provider | Route class | Client |
| --- | --- | --- |
| Anthropic | `ClaudeVertexAiAccessRoute` | `AnthropicVertex` from `@anthropic-ai/vertex-sdk` |
| Google | `GeminiVertexAiAccessRoute` | `GoogleGenAI` from `@google/genai`, constructed with `vertexai: true` |

```js
import {
  AnthropicVertex,
} from '@anthropic-ai/vertex-sdk'

import environment from '../../globals/env.js'
import ClaudeSdkApiClient from '../../claudeClient/ClaudeSdkApiClient.js'
import BaseAiAccessRoute from './BaseAiAccessRoute.js'

import CONSTANT_HASH from '../../../constants/aiConstants.cjs'

const {
  AI_PROVIDER,
  AI_ACCESS_ROUTE,
} = CONSTANT_HASH

export default class ClaudeVertexAiAccessRoute extends BaseAiAccessRoute {
  static create () {
    return new this()
  }

  get aiProviderId () {
    return AI_PROVIDER.ANTHROPIC.ID
  }

  get accessRouteName () {
    return AI_ACCESS_ROUTE.VERTEX_AI.NAME
  }

  get supportsFileUpload () {
    return false
  }

  createClient () {
    return ClaudeSdkApiClient.create({
      sdkClient: new AnthropicVertex({
        projectId: environment.VERTEX_AI_PROJECT_ID,
        region: environment.VERTEX_AI_LOCATION,
      }),
    })
  }
}
```

`GeminiVertexAiAccessRoute#createClient()` builds its SDK client the same way, with the option names the
Google Gen AI SDK defines for Vertex AI:

```js
import {
  GoogleGenAI,
} from '@google/genai'

new GoogleGenAI({
  vertexai: true,
  project: environment.VERTEX_AI_PROJECT_ID,
  location: environment.VERTEX_AI_LOCATION,
})
```

- **Authentication is ADC**, which the Google auth library resolves in this order: the key file named by
  `GOOGLE_APPLICATION_CREDENTIALS`, the credentials `gcloud auth application-default login` stores, and the
  service account attached to the runtime (Cloud Run, GKE, Compute Engine). On a server, attach the service account to the
  runtime so no key file exists. Use a key file only where nothing can be attached, and keep it outside the
  repository and outside the DB.
- **Grant the service account only a Vertex AI prediction role** on the project (for example Vertex AI
  User), never an owner or editor role.
- **Pass the project and location explicitly from env** (`VERTEX_AI_PROJECT_ID`, `VERTEX_AI_LOCATION`,
  app-level names) so the route is the one place that reads them. `AnthropicVertex` would otherwise read
  `CLOUD_ML_REGION` and `ANTHROPIC_VERTEX_PROJECT_ID` from the process by itself. For Claude, `region` also
  accepts `'global'`; check which models the chosen location serves before seeding a row.
- **The Claude payload is unchanged.** `AnthropicVertex` takes the same Messages params as the direct
  client, moves `model` into the request path, and sets `anthropic_version` when the body lacks it. So
  `ClaudeSdkApiClient#sendMessageToClaude(params)` is `sdkClient.messages.create(params)`, streaming is
  `sdkClient.beta.messages.stream(params)` as in the direct client, and `SendMessageToClaudeCapsule` parses the result as it
  does for the direct route. Do not send the `anthropic-beta: files-api-...` header on this route.
- **`targetModelName` takes the Vertex spelling**, which puts the version after an `@` (for example
  `claude-sonnet-4-5@20250929`), where the direct id uses a dash. Seed it as its own
  `AiModelAccessRoute` row.
- **`supportsFileUpload` is `false`** for both classes. The SDK rewrites only the message paths, so the
  Files API upload in `#prepareAttachedFiles()` does not go through it.
- **Gemini on Vertex** needs a client with the same surface as the direct Gemini client
  (`GeminiSdkApiClient`) that maps the existing `contents` payload onto the SDK's request. The function-call
  shape (`functionCall` / `functionResponse`) does not change.
- Add the two env vars, `AI_ACCESS_ROUTE.VERTEX_AI`, and one `AiModelAccessRoute` row per reachable model.
