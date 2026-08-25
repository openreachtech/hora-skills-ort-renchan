# Provider internals (function calls, file upload, payloads, response, clients)

Referenced from `SKILL.md`. This is the per-vendor detail behind the uniform processor surface. The
concrete model processors are identical except for `#get:aiModel`; the differences below live in the
three provider bases under `app/tools/BaseAiModelProviderProcessor/` and the payload generators under
`app/tools/AiPayloadGenerator/`.

## Function-call feedback — the one real per-vendor difference

Each provider base runs the same shape: filter the AI response for tool calls, run each tool via the
`BulkAiToolProcessorsLoader` (`getProcessor(toolName).process({ ...input, extraToolOptions })`), then push
the tool results back into the payload and re-request. Only the **event type**, the **result envelope**,
and the **payload channel** differ.

| Vendor | Function-call event | Tool result fed back as | Payload channel | Arguments |
| --- | --- | --- | --- | --- |
| Claude | `response.type === 'tool_use'` | `{ type: 'tool_result', tool_use_id, content }` (role `user`) | `payloadParams.messages` | `response.input` (object) |
| OpenAI | `response.type === 'function_call'` | original call + `{ type: 'function_call_output', call_id, output }` | `payloadParams.input` | `JSON.parse(response.arguments)` |
| Gemini | `functionCall` part | `{ role: 'model', parts: [{ functionCall }] }` + `{ role: 'user', parts: [{ functionResponse: { name, response: { result } } }] }` | `payloadParams.contents` | `response.arguments` (already an object) |

Claude's loop, verbatim (the other two mirror it with the shapes above):

```js
const functionCalls = aiResponses.filter(response => response.type === 'tool_use')

const toolResults = await functionCalls.reduce(
  async (resultsPromise, response) => {
    const collectedResults = await resultsPromise

    const aiToolProcessor = bulkAiToolProcessorsLoader.getProcessor(response.name)

    const toolResult = await aiToolProcessor.process({
      ...response.input,
      extraToolOptions: {
        ...extraToolOptions,
        toolName: response.name,
      },
    })

    collectedResults.push({
      type: 'tool_result',
      tool_use_id: response.id,
      content: toolResult.toString(),
    })

    return collectedResults
  },
  Promise.resolve([])
)

payloadParams.messages.push({
  role: 'user',
  content: toolResults,
})
```

`#handleStreamingFunctionCalls()` is the streaming counterpart: it builds the same follow-up payload, then
calls the streaming fetcher forwarding `{ onText, onComplete }` (Claude/Gemini) or `{ onText, onComplete,
onError }` (Claude adds `onError`).

## File upload — `#prepareAttachedFiles({ fileUrls })`

Each provider base overrides `#prepareAttachedFiles()` to upload attachments once and reuse them, keyed by
the uploaded file's `idHash` (extracted from the file URL's last path segment; base URLs come from
`env.BASE_EMPLOYEE_FILE_URL` / `env.BASE_CLIENT_FILE_URL`). It maps app `UploadedFile` rows to a
per-provider upload record, reusing an existing one when valid, else uploading and saving.

| Vendor | Upload record model | Reuse rule | File identity attached |
| --- | --- | --- | --- |
| Claude | `ClaudeUploadedFile` | always reusable (Claude file ids do not expire) | `claudeFileId` |
| OpenAI | `OpenAiUploadedFile` | reusable if no `expiresAt`, else `expiresAt > now` (Unix seconds → Date) | `openAiFileId` |
| Gemini | `GeminiUploadedFile` | reusable if `expiresAt > now` (ordered by `expiresAt` DESC) | `geminiFileUri` |

Only files that end up with a provider id/uri are returned. The `AttachedFile` typedef on
`BaseAiModelProcessor` carries all three optional identities (`claudeFileId` / `openAiFileId` /
`geminiFileUri`) plus `fileUrl` / `fileType`.

## Payload generators (`app/tools/AiPayloadGenerator/`)

`BaseAiMessagePayloadGenerator` holds the shared state (`aiAgent`, `aiModel`, `targetAiModel`, `message`,
`historyMessages`, `maxTokens`, `tools`, `emotionalLevel`, `fileUrls`, `toolChoices`) and the
history-trimming helpers (`#extractFilteredHistoryMessages(...)`, `#createMessageTokenLimiter(...)` →
`MessageTokenLimiter` for token-budget trimming). Each provider generator extends it.

`ClaudeMessagePayloadGenerator` (the others mirror it):

- `#generateClaudeMessagePayload()` — system prompt = `aiAgent.AiAgentRoleInstruction.role`; trims history;
  `messages = [...formattedHistory, { role: 'user', content: generateMessagesContent() }]`; returns
  `SendMessageToClaudePayload.create({ params })`.
- `#generatePayloadParams(...)` — omit `tools` / `toolChoice` entirely when there are no tools; else include
  `tools` + `toolChoice: generateToolChoice()`.
- `#generateToolChoice()` — `{ type: 'auto' }` (none) / `{ type: 'tool', name }` (exactly one — the forced
  single tool) / `{ type: 'any' }` (multiple).
- `#formatSingleMessage()` — role from `MESSAGE_SENDER_CATEGORY.HUMAN.ID` → `'user'` else `'assistant'`;
  appends document linkages + one-time documents.
- `#generateMessagesContent()` / `#generateFileSource()` — text block + file blocks; a file block prefers
  `{ type: 'file', file_id: claudeFileId }` when a Claude file id exists, else `{ type: 'url', url }`;
  `#extractTypeFromFileType()` → `'document'` (PDF) or `'image'`.

Provider nuances: OpenAI's `#generateOpenAiMessagePayload()` is async (awaited) and passes
`emotionalLevel: null`; Gemini/OpenAI use their own message channels (`contents` / `input`).

## `AiModelResponse` and the capsule surface

`AiModelResponse.create({ aiResponseCapsule })` is a thin uniform wrapper. Each method guards that the
capsule implements it, then delegates:

```js
extractFunctionCalls () {
  return this.aiResponseCapsule.extractFunctionCalls()
}

extractContentText () {
  return this.aiResponseCapsule.extractContentText()
}

extractErrorMessage () {
  return this.aiResponseCapsule.extractErrorMessage()
}

hasError () {
  return this.aiResponseCapsule.hasError()
}
```

The real logic is in the provider capsule (e.g. `SendMessageToClaudeCapsule extends BaseCapsule` from
`@openreachtech/renchan-tools-external-api`), which every vendor implements with the same surface:
`#hasError()`, `#extractContent()`, `#hasFunctionCallEvent()`, `#extractFunctionCalls()` (→
`{ name, arguments }`), `#extractContentText()`, plus model / role / stop-reason / token-usage extractors.
**This shared surface is what makes the whole abstraction provider-agnostic** — the forced-tool actions in
the `hb-ai-agent-structure` skill call `response.hasError()` / `response.extractFunctionCalls()` without knowing
the vendor.

## Low-level clients (`app/claudeClient/`, `app/geminiClient/`, `app/openAiClient/`)

Each provider dir has the same ~11-file layout: for each operation (SendMessage, StreamingMessage,
UploadFile) a **Payload** (request builder; `#create({ params })`, `#toActualParams()`), a **Fetcher**
(extends `Base<Provider>ApiRequestLauncher` → `BaseRequestLauncher` from
`@openreachtech/renchan-tools-external-api`; `#launchRequest()` / `#launchStreamRequest()`, defines
`#get:CapsuleClass` and `#requestToClient()`), and a **Capsule** (normalizes the response). Plus one shared
**ApiClient** and one shared **Base...RequestLauncher** that reads the vendor key/base URL from env.

- `SendMessageToClaudeFetcher#get:CapsuleClass` → `SendMessageToClaudeCapsule`;
  `#requestToClient(p)` → `this.client.sendMessageToClaude({ ...p })`.
- `ClaudeApiClient` — constructed `{ token, httpRequestClient }`; `#sendMessageToClaude()` POSTs `/messages`
  with `x-api-key`, `anthropic-version`, `anthropic-beta: files-api-2025-04-14`; `#uploadFileToClaude()`
  POSTs `/files` as FormData; streaming uses the official SDK
  (`import Anthropic from '@anthropic-ai/sdk'` → `client.beta.messages.stream(...)`).
- `Base<Provider>ApiRequestLauncher` reads `environment.CLAUDE_API_TOKEN` / `environment.CLAUDE_API_BASE_URL`
  (and the OpenAI/Gemini analogues) from the renchan-env facade.

This Launcher/Payload/Capsule/Client shape is the same external-API-client pattern the **external-api-client
skill** describes; here it is specialized per LLM vendor.
