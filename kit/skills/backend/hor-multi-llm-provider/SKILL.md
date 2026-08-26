---
name: hor-multi-llm-provider
description: >
  Support multiple LLM providers (Anthropic Claude / OpenAI / Google Gemini) behind one
  abstraction in a renchan backend: an abstract model processor, one provider base per vendor, one
  concrete processor per model, and a loader that picks one by model name at runtime, with model
  and provider metadata in the DB and env, not in code. Use whenever the user asks to add an LLM
  model or provider, change how a model is selected, normalize provider responses, or wire
  function calls and file upload.
---

# Multi-LLM Provider (Claude / OpenAI / Gemini behind one abstraction)

This backend talks to three LLM vendors through **one processor abstraction** so callers (agents,
resolvers, jobs) never branch on the provider. A caller resolves a **model name** to a processor and calls
`processor.sendRequestToAi(...)`; everything provider-specific (SDK calls, function-call shape, file
upload, response parsing) is hidden behind the processor and its capsule.

## Grand principle: one base + one subclass per model; provider differences live in a provider base, the model is chosen from the DB

The abstraction is a three-level strategy: `BaseAiModelProcessor` (the contract) → one **provider base**
per vendor (Claude/OpenAI/Gemini plumbing) → one **concrete processor per model** whose only distinct
member is `#get:aiModel`. A loader auto-discovers the concrete processors and picks one by model-name
string at runtime.

- **Why a per-model class whose only identity is `#get:aiModel`**: adding a model must be additive
  (Open–Closed) — drop one file whose `#get:aiModel` returns the new name, and the loader finds it. The
  concrete class holds *no* target model id or token limit; those come from the DB `AiModel` /
  `AiModelCapability` rows, so a model's real endpoint and limits are data, not code.
- **Why a provider base between them**: the three vendors differ only in a few mechanics —
  function-call event shape (`tool_use` vs `function_call` vs `functionCall`), how tool results are fed
  back (`messages` vs `input` vs `contents`), and file upload (Claude file id / OpenAI file id / Gemini
  file uri). Concentrating those in one provider base per vendor keeps every concrete model processor
  identical except for its name.
- **Why normalize responses through `AiModelResponse`**: callers must read `#hasError()`,
  `#extractFunctionCalls()`, `#extractContentText()` the same way regardless of vendor. Each provider's
  capsule exposes the same method surface; `AiModelResponse` is the thin uniform wrapper over it.
- **Why choose the model from the DB**: which model an agent uses is per-agent config
  (`AiAgentDefaultModel → AiModel.name`), overridable per call — never hard-coded. Swapping a model is a
  data change.

## Layers and files

```
app/tools/
  BaseAiModelProcessor.js                     abstract contract (get aiModel, sendRequestToAi, ...)
  BaseAiModelProviderProcessor/
    BaseClaudeAIProcessor.js                  Claude function-call loop + Files API upload
    BaseOpenAIProcessor.js                    OpenAI function_call + file upload (with expiry)
    BaseGeminiAIProcessor.js                  Gemini functionCall + file uri upload
  AiModelProcessor/
    ClaudeSonnet4_5AiModelProcessor.js        concrete: get aiModel + sendRequestToAi
    OpenAiGPT_5_AiModelProcessor.js           (~21 concrete model files, one per model)
    Gemini2_5FlashAiModelProcessor.js
    ...
  BulkAiModelProcessorsLoader.js              auto-discovery + getProcessor(aiModel)
  AiPayloadGenerator/
    BaseAiMessagePayloadGenerator.js          shared history trimming / token budget
    ClaudeMessagePayloadGenerator.js          provider payload shaping (tools, toolChoice, files)
    OpenAiMessagePayloadGenerator.js
    GeminiMessagePayloadGenerator.js
  AiModelResponse.js                          normalized response wrapper
app/claudeClient/ | app/geminiClient/ | app/openAiClient/   low-level Launcher/Payload/Capsule/Client
```

## 1. The contract — `BaseAiModelProcessor`

Abstract members a concrete processor must satisfy:

- `#get:aiModel` (abstract) — the model-name string the loader matches on (e.g. `'sonnet-4-5'`).
- `#sendRequestToAi({ ... })` (abstract) — non-streaming request; returns an `AiModelResponse`.
- `#sendStreamRequestToAi({ ..., onText, onComplete })` (abstract) — streaming variant.
- `#prepareAttachedFiles({ fileUrls })` (concrete default: returns `fileUrls` unchanged) — overridden per
  provider to upload files and attach provider file ids/uris.
- `#findAiModelByName({ aiModelName })` (concrete) —
  `AiModel.findOne({ where: { name }, include: [AiModelCapability] })`; this is how a processor gets its
  DB-backed `targetModelName` and `maxOutputToken`.

The request param bag is uniform across providers:

```js
async sendRequestToAi ({
  aiAgent,
  instruction,
  documents,
  fileUrls,
  historyMessages = [],
  tools = [],
  toolChoices = [],
  isAutoHandleFunctionCall = true,
  extraToolOptions = {},
  shouldPrefetchDynamicDocumentsForBackground = false,
}) {
  // ...
}
```

## 2. A concrete model processor — only `#get:aiModel` is unique

Everything else (build the instruction, prepare files, build the payload, send, handle one round of
function calls, wrap the response) is the same standard flow inherited/composed from the provider base.

```js
import BaseClaudeAIProcessor from '../BaseAiModelProviderProcessor/BaseClaudeAIProcessor.js'
import AiModelResponse from '../AiModelResponse.js'

import CONSTANT_HASH from '../../../constants/aiConstants.cjs'

const {
  AI_MODEL,
} = CONSTANT_HASH

export default class ClaudeSonnet4_5AiModelProcessor extends BaseClaudeAIProcessor {
  static create () {
    return new this()
  }

  get aiModel () {
    return AI_MODEL.CLAUDE_SONNET_4_5.NAME
  }

  async sendRequestToAi ({
    aiAgent,
    instruction,
    documents,
    fileUrls,
    historyMessages = [],
    tools = [],
    toolChoices = [],
    isAutoHandleFunctionCall = true,
    extraToolOptions = {},
    shouldPrefetchDynamicDocumentsForBackground = false,
  }) {
    const aiModel = await this.findAiModelByName({
      aiModelName: this.aiModel,
    })

    const documentInstructionComposer = await this.createDocumentInstructionComposer({
      // ...splits documents, wires the agent's default instruction (see `hor-ai-prompt-document-store` skill)
    })

    const preparedFileUrls = await this.prepareAttachedFiles({
      fileUrls,
    })

    const payloadGenerator = this.createClaudeMessagePayloadGenerator({
      aiAgent,
      aiModel,
      message: documentInstructionComposer.generateComposedInstruction(),
      fileUrls: preparedFileUrls,
      historyMessages,
      tools,
      toolChoices,
    })

    const payload = payloadGenerator.generateClaudeMessagePayload()
    const fetcher = this.createSendMessageToClaudeFetcher()
    const capsule = await fetcher.launchRequest(payload)

    if (capsule.hasError()) {
      return AiModelResponse.create({
        aiResponseCapsule: capsule,
      })
    }

    if (!capsule.hasFunctionCallEvent()) {
      return AiModelResponse.create({
        aiResponseCapsule: capsule,
      })
    }

    if (!isAutoHandleFunctionCall) {
      return AiModelResponse.create({
        aiResponseCapsule: capsule,
      })
    }

    const followUpPayload = await this.handleFunctionCalls({
      payloadParams: payload.params,
      aiResponses: capsule.extractContent(),
      extraToolOptions,
    })

    const followUpCapsule = await fetcher.launchRequest(followUpPayload)

    return AiModelResponse.create({
      aiResponseCapsule: followUpCapsule,
    })
  }
}
```

- **`targetModelName` and `maxOutputToken` come from the DB row**, not the class. `#get:aiModel` returns
  the app-facing name (`AI_MODEL.*.NAME`); the DB row's `targetModelName` is the vendor API model id
  (e.g. `'claude-sonnet-4-5-20250929'`).
- **`isAutoHandleFunctionCall: false`** short-circuits after the first response and returns the raw
  function call — this is exactly what the forced-single-tool actions in the **`hor-ai-agent-structure` skill**
  rely on.
- The flow handles **one** round of function calls (one follow-up request), not an open-ended tool loop.

## 3. Runtime selection — `BulkAiModelProcessorsLoader`

The loader auto-discovers every class under `app/tools/AiModelProcessor/` with renchan's
`DeepBulkClassLoader`, instantiates each via `.create()`, and picks one by matching `#get:aiModel`:

```js
import {
  DeepBulkClassLoader,
} from '@openreachtech/renchan'

// ...
static async loadProcessorClasses (path) {
  return DeepBulkClassLoader.create({
    poolPath: path,
  })
    .loadClasses()
}

getProcessor (aiModel) {
  return this.processors.find(processor => processor.aiModel === aiModel)
}
```

The model **name** passed to `#getProcessor()` comes from the DB — the agent's default model, overridable
per call:

```js
// explicit id wins, else the agent's default model
const targetAiModelId = aiModelId
  ?? aiAgentDefaultModel?.AiModelId
  ?? null

const aiModel = await AiModel.findByPk(targetAiModelId)
const processor = this.bulkAiModelProcessorsLoader.getProcessor(aiModel.name)
```

or directly via the agent's default-model chain
`aiAgent.AiAgentDefaultModel.AiModel.name → getProcessor(...)`.

> Do not confuse this with `BulkAiToolProcessorsLoader`: the provider bases use a *tool*-processor loader
> (`getProcessor(toolName)`) to run function calls — a different loader over `app/aiTools/`.

## 4. Adding a model or a provider

- **New model of an existing provider**: add one file under `app/tools/AiModelProcessor/` extending that
  provider base, with `#get:aiModel` returning the new `AI_MODEL.*.NAME`; add the `AiModel` +
  `AiModelCapability` rows (and `AiModelToolAssignment` rows) via a seeder; add the `AI_MODEL` entry in
  `constants/aiConstants.cjs`. No caller changes — the loader finds it.
- **New provider**: add a provider base under `app/tools/BaseAiModelProviderProcessor/` implementing the
  function-call handling + `#prepareAttachedFiles()` for that vendor, a payload generator under
  `AiPayloadGenerator/`, a capsule that exposes the standard method surface, the low-level
  Launcher/Payload/Capsule/Client under `app/<provider>Client/`, and an `AI_PROVIDER` entry. Then per-model
  processors as above.

See [provider-internals.md](./references/provider-internals.md) for the per-vendor function-call and
file-upload differences, the payload generators, `AiModelResponse`, and the low-level client pattern.

## 5. Config and secrets

- **`AiProvider`** (`ai_providers`): `name`. `AI_PROVIDER = { ANTHROPIC {ID:1}, GOOGLE {ID:2}, OPENAI {ID:3} }`.
- **`AiModel`** (`ai_models`): `AiProviderId`, `name` (app key), `targetModelName` (vendor id), `isDefault`,
  `isActive`, `displayOrder`.
- **`AiModelCapability`** (`ai_model_capabilities`): `contextWindowToken`, `maxOutputToken` (→ payload
  `maxTokens`).
- **`AiModelToolAssignment`** (`ai_model_tool_assignments`): which tools a model may use (see the
  `hor-ai-prompt-document-store` skill for `AiTool`).
- **API keys / base URLs** come from `@openreachtech/renchan-env` via `app/globals/env.js` (e.g.
  `CLAUDE_API_TOKEN`, `CLAUDE_API_BASE_URL`, and the analogous OpenAI/Gemini vars) — never hard-code a key.

Model/provider constants live in `constants/aiConstants.cjs` (see the **`hor-constant-definition` skill** for the
two-file `.cjs` master + ESM bridge rule).

## Cross-cutting rules

- **Callers never branch on the provider** — resolve a processor by name and use the uniform
  `#sendRequestToAi()` / `AiModelResponse` surface.
- **A concrete model processor adds no logic beyond `#get:aiModel`** — put shared behavior on the provider
  base, per-vendor behavior on the provider base too, and model specifics in the DB.
- **Return `null` / a normalized error response, not `undefined`**, on failure; check `#hasError()` before
  reading content.
- One class per file, one `export default`, `static create()` factory; getters return a constant.

## Detail files

- [provider-internals.md](./references/provider-internals.md) — the three provider bases' function-call
  feedback shapes and file-upload models (Claude/OpenAI/Gemini), the payload generators
  (tools/toolChoice/history trimming/file source), the `AiModelResponse` + capsule method surface, and the
  low-level Launcher/Payload/Capsule/Client pattern with where API keys are read.
