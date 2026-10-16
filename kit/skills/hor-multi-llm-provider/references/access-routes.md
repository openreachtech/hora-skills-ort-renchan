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

`BaseAiAccessRoute` sits in `app/tools/`, outside the pool path, as `BaseAiModelProcessor` does, so
discovery never instantiates the abstract base.

## Route rows

`AiModelAccessRoute` holds one row per model and route the model is reachable through. The same model has
a different `targetModelName` on each route:

| `AiModel.name` | `accessRouteName` | `targetModelName` shape | `isDefault` |
| --- | --- | --- | --- |
| `sonnet-4-5` | `direct` | `claude-sonnet-4-5-20250929` | true |
| `sonnet-4-5` | `vertex-ai` | `claude-sonnet-4-5@20250929` | false |
| `sonnet-4-5` | `bedrock` | `anthropic.claude-sonnet-4-5-20250929-v1:0` | false |

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
import BaseAiAccessRoute from '../BaseAiAccessRoute.js'

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
Google Gen AI SDK defines for Vertex AI (its documentation now recommends the `enterprise` flag over
`vertexai` for the same switch):

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
- **An SDK client throws on a failed request.** `ClaudeSdkApiClient` must convert the thrown error into
  whatever the capsule's `#hasError()` reads, so callers still get a normalized error response and never
  a route-specific exception.
- **`targetModelName` takes the Vertex spelling**, which puts the version after an `@` (for example
  `claude-sonnet-4-5@20250929`), where the direct id uses a dash. Seed it as its own
  `AiModelAccessRoute` row.
- **`supportsFileUpload` is `false`** for both classes. The SDK rewrites only the message paths, so the
  Files API upload in `#prepareAttachedFiles()` does not go through it.
- **Gemini on Vertex** needs a client with the same surface as the direct Gemini client
  (`GeminiSdkApiClient`) that maps the existing `contents` payload onto the SDK's request. The function-call
  shape (`functionCall` / `functionResponse`) does not change.
- Add the two env vars, `AI_ACCESS_ROUTE.VERTEX_AI`, and one `AiModelAccessRoute` row per reachable model.

## The Bedrock route (AWS credentials)

Claude hosted on Amazon Bedrock, reached with **AWS credentials** (SigV4 signing), not the vendor key.

| Provider | Route class | Client |
| --- | --- | --- |
| Anthropic | `ClaudeBedrockAiAccessRoute` | `AnthropicBedrock` from `@anthropic-ai/bedrock-sdk` |

```js
import {
  AnthropicBedrock,
} from '@anthropic-ai/bedrock-sdk'

import environment from '../../globals/env.js'
import ClaudeSdkApiClient from '../../claudeClient/ClaudeSdkApiClient.js'
import BaseAiAccessRoute from '../BaseAiAccessRoute.js'

import CONSTANT_HASH from '../../../constants/aiConstants.cjs'

const {
  AI_PROVIDER,
  AI_ACCESS_ROUTE,
} = CONSTANT_HASH

export default class ClaudeBedrockAiAccessRoute extends BaseAiAccessRoute {
  static create () {
    return new this()
  }

  get aiProviderId () {
    return AI_PROVIDER.ANTHROPIC.ID
  }

  get accessRouteName () {
    return AI_ACCESS_ROUTE.BEDROCK.NAME
  }

  get supportsFileUpload () {
    return false
  }

  createClient () {
    return ClaudeSdkApiClient.create({
      sdkClient: new AnthropicBedrock({
        awsRegion: environment.BEDROCK_AWS_REGION,
      }),
    })
  }
}
```

- **Authentication is the AWS default credential chain.** Pass no key options and the client signs with
  whatever the chain finds: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (and `AWS_SESSION_TOKEN`) in the
  process, a shared profile or SSO login, or the role attached to the runtime (ECS task, EC2 instance
  profile). On a server, prefer the attached role so no secret exists. Where the keys must come through
  `env.js` under app-level names, pass all three as `awsAccessKey`, `awsSecretKey` and `awsSessionToken`;
  pass both or neither of the first two.
- **Never set `AWS_BEARER_TOKEN_BEDROCK` in a process that should sign with IAM credentials.** The client
  reads it by default and sends it as a bearer token instead of signing, so the IAM role is silently
  ignored.
- **Pass the region explicitly** (`BEDROCK_AWS_REGION`, an app-level name). When neither `awsRegion` nor
  `AWS_REGION` is set, the client falls back to `us-east-1`, which may not be where the model is enabled.
- **Grant only the invoke actions**: `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`,
  scoped to the model or inference-profile ARNs the app uses.
- **The Claude payload is unchanged.** Like `AnthropicVertex`, `AnthropicBedrock` takes the same Messages
  params, moves `model` into the request path (`/model/{model}/invoke`, or
  `invoke-with-response-stream` when streaming), and sets `anthropic_version` when the body lacks it. It
  also copies the `anthropic-beta` header into the body, so the `files-api` beta has no use here. The same
  `ClaudeSdkApiClient` and `SendMessageToClaudeCapsule` serve this route and the Vertex AI route.
- **`targetModelName` takes the Bedrock spelling**, in the shape `anthropic.claude-sonnet-4-5-20250929-v1:0`.
  A model that Bedrock serves only through a cross-region inference profile takes the profile id, which
  prefixes a geography (for example `us.anthropic.claude-...`). Seed the id the Bedrock console lists for
  the region, and confirm the AWS account may invoke that model there.
- **`supportsFileUpload` is `false`**, for the same reason as on Vertex AI: the SDK rewrites only the
  message paths.
- **This route serves Claude only**, because `@anthropic-ai/bedrock-sdk` serves Claude models. Another
  vendor's model on Bedrock is a new provider base with its own client, not a route of an existing one.
- Add `BEDROCK_AWS_REGION`, `AI_ACCESS_ROUTE.BEDROCK`, and one `AiModelAccessRoute` row per Claude model
  the account can invoke.
