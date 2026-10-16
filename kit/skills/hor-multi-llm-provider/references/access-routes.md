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
