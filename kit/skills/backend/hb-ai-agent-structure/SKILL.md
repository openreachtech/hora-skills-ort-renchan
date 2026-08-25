---
name: hb-ai-agent-structure
description: >
  Structure an app-side AI agent on @openreachtech/mentsu-agent-loop-core in a renchan backend: an
  app/agents/<name>/ directory holding a ProceduralAgentLoop subclass (fixed procedure) plus
  per-step BaseAgentAction subclasses, driven synchronously by a generator tool, each AI step
  making one forced tool call. Use whenever the user asks to add or edit such an agent, an agent
  action, or the generator that runs the loop. The iteration engine itself is a separate
  convention.
---

# AI Agent Structure (app-side agents on mentsu-agent-loop-core)

This skill covers **how this backend structures an AI agent as application code** — the directory layout,
the `ProceduralAgentLoop` subclass, the per-step actions, and the `*Generator` that runs the loop. The
iteration engine, progress delivery, composition, job execution, and GraphQL integration are provided by
the `@openreachtech/mentsu-agent-loop-core` package family; see the **`hb-agent-loop` skill** for those. Do
not re-explain the core package here — this skill is only the app layer on top of it.

## Grand principle: the procedure is code, the AI only judges inside a step

An app agent here is a **`ProceduralAgentLoop`** whose steps are fixed in code (e.g. `plan → execute →
compose`), where each step either runs a **single forced AI tool call** or runs **deterministic code** —
never an open-ended "let the AI decide what to do next" loop.

- **Why a procedural loop, not an AI-driven one**: the business shape (search records, fill a form) is
  known; only small judgments (is this a search request? what are the search steps? phrase the answer)
  need the model. Fixing the procedure in `advanceState` keeps the flow reviewable, testable, and cheap
  (usually one iteration), and confines model non-determinism to individual steps.
- **Why one forced tool call per AI step**: each AI step declares exactly one tool and forces it
  (`toolChoices: [{ name }]`, `isAutoHandleFunctionCall: false`), then reads the function-call arguments
  as the step's typed output. This turns a free-text model into a structured function returning a known
  shape, so the surrounding code can validate and branch on it.
- **Why load the tool schema from the DB**: the tool JSON (name, description, parameters) lives in the
  `AiTool` table, not in code. The action only holds the tool's **id**; swapping wording or parameters is
  a data change, not a deploy. See the **`hb-ai-prompt-document-store` skill**.
- **Everything reaches AI / DB / services through `context`.** Actions and the loop never import an AI
  client or a repository directly; they read `context.processor`, `context.recordSearchService`, etc. This
  is the one-way dependency of the agent-loop core — keep it.

## Directory layout

One directory per agent under `app/agents/<agentName>/`, with the loop at the top and actions in
`actions/`:

```
app/agents/recordSearch/
  RecordSearchAgentLoop.js              extends ProceduralAgentLoop
  actions/
    BaseRecordSearchAgentAction.js      extends BaseAgentAction (app base, abstract)
    ClassifySearchIntentAction.js       run standalone by the generator (intent gate)
    PlanSearchAction.js                 registered: 'planSearch'
    ExecuteSearchPlanAction.js          registered: 'executeSearchPlan' (no AI — pure code)
    ComposeAnswerAction.js              registered: 'composeAnswer'
```

The runner/wiring lives one level up in `app/tools/<Agent>Generator.js` (e.g.
`RecordSearchGenerator.js`). Keep the layout identical across agents so review attention goes to the
agent's *procedure*.

## 1. The loop — a `ProceduralAgentLoop` subclass

Override these members (no constructor, no `static create` — `InlineAgentRunner` instantiates the loop
with the `context`):

| Member | Responsibility |
| --- | --- |
| `#get:maxIterations` | Iteration cap (a procedural agent usually finishes in 1; e.g. `4`) |
| `#get:registry` | `AgentActionRegistry.create({ actions: [...] })` — the actions the procedure can call |
| `#createInitialState({ input })` | The starting state object (e.g. `{ result: null }`) |
| `#advanceState({ state })` | **The procedure body** — the ordered steps |
| `#isComplete({ state })` | Stop condition (e.g. `Boolean(state.result)`) |
| `#buildResult({ state })` | The final return value (e.g. `state.result`) |

`#advanceState()` calls `this.performAction({ name, argumentHash, context })` for each step, matching an
action by its `#get:name`. Deterministic branches (e.g. "couldn't understand the request") are written as
plain code between the AI steps.

```js
import {
  ProceduralAgentLoop,
  AgentActionRegistry,
} from '@openreachtech/mentsu-agent-loop-core'

import PlanSearchAction from './actions/PlanSearchAction.js'
import ExecuteSearchPlanAction from './actions/ExecuteSearchPlanAction.js'
import ComposeAnswerAction from './actions/ComposeAnswerAction.js'

export default class RecordSearchAgentLoop extends ProceduralAgentLoop {
  get maxIterations () {
    return 4
  }

  get registry () {
    return AgentActionRegistry.create({
      actions: [
        PlanSearchAction.create(),
        ExecuteSearchPlanAction.create(),
        ComposeAnswerAction.create(),
      ],
    })
  }

  createInitialState ({
    input,
  }) {
    return {
      result: null,
    }
  }

  async advanceState ({
    state,
  }) {
    const plan = await this.performAction({
      name: 'planSearch',
      argumentHash: {
        message: this.context.message,
        searchableCategories: this.context.searchableCategories,
      },
      context: this.context,
    })

    if (!plan) {
      return {
        ...state,
        result: {
          message: 'I could not turn that into a record search. Could you rephrase what you are looking for?',
          targetRecords: [],
        },
      }
    }

    const executed = await this.performAction({
      name: 'executeSearchPlan',
      argumentHash: {
        plan,
      },
      context: this.context,
    })

    const answer = await this.performAction({
      name: 'composeAnswer',
      argumentHash: {
        message: this.context.message,
        resultSummary: {
          foundCount: executed.targetRecords.length,
          isTruncated: executed.isTruncated,
          resultCategoryName: this.resolveCategoryName({
            originObjectCategoryId: executed.resultOriginObjectCategoryId,
          }),
        },
      },
      context: this.context,
    })

    return {
      ...state,
      result: {
        message: answer.message,
        targetRecords: executed.targetRecords,
      },
    }
  }

  isComplete ({
    state,
  }) {
    return Boolean(state.result)
  }

  buildResult ({
    state,
  }) {
    return state.result
  }
}
```

- **State is updated immutably** (`{ ...state, ... }`) — never mutate it in place.
- **`registry` is rebuilt each access** — it is cheap and keeps the getter pure.
- Progress within the procedure is forwarded through `this.context.notifyProgress?.({ phase, status })`
  (a no-op unless the caller sets it), not through the runner's `onProgress`.

## 2. Actions — an app base over `BaseAgentAction`, one forced tool call each

Each agent has an abstract app base (e.g. `BaseRecordSearchAgentAction extends BaseAgentAction`) holding
the shared forced-tool helpers; each concrete action overrides `#get:name`, `#get:description`, and
`#run()`.

App-base helpers (the forced-single-tool machinery):

| Method | Responsibility |
| --- | --- |
| `#loadToolPayloadObject({ aiToolId })` | `AiTool.findByPk(aiToolId)` → `JSON.parse(payload)`, `null` on missing/parse error |
| `#sendForcedToolRequest({ context, instruction, toolPayloadObject })` | one AI turn: `context.processor.sendRequestToAi(...)` forcing the single tool |
| `#extractFunctionCallFromAiResponse({ response, toolName })` | first function call whose name matches, else `null` |
| `#parseFunctionCallArguments({ functionCall })` | parse `functionCall.arguments` (string→JSON), `null` on error |

```js
import {
  BaseAgentAction,
} from '@openreachtech/mentsu-agent-loop-core'

import AiTool from '../../../../sequelize/models/AiTool.js'

/** @abstract */
export default class BaseRecordSearchAgentAction extends BaseAgentAction {
  async loadToolPayloadObject ({
    aiToolId,
  }) {
    const aiTool = await AiTool.findByPk(aiToolId)

    if (!aiTool) {
      return null
    }

    try {
      return JSON.parse(aiTool.payload)
    } catch (error) {
      return null
    }
  }

  async sendForcedToolRequest ({
    context,
    instruction,
    toolPayloadObject,
  }) {
    return context.processor.sendRequestToAi({
      aiAgent: context.aiAgent,
      documents: context.documents,
      extraToolOptions: {},
      fileUrls: context.files,
      historyMessages: context.historyMessages,
      instruction,
      isAutoHandleFunctionCall: false,
      toolChoices: [
        {
          name: toolPayloadObject.name,
        },
      ],
      tools: [
        toolPayloadObject,
      ],
    })
  }
}
```

A concrete AI action then runs the fixed flow — load tool → build instruction → force the call → extract
→ parse → return a typed value (return `null` / a fallback on any failure, never `undefined`):

```js
export default class PlanSearchAction extends BaseRecordSearchAgentAction {
  get name () {
    return 'planSearch'
  }

  get description () {
    return 'Decompose the request into ordered record-search steps'
  }

  get toolName () {
    return 'plan_record_search'
  }

  async run ({
    argumentHash: {
      message,
      searchableCategories,
    },
    context,
  }) {
    const toolPayloadObject = await this.loadToolPayloadObject({
      aiToolId: context.planRecordSearchAiToolId,
    })

    if (!toolPayloadObject) {
      return null
    }

    const instruction = this.buildInstruction({
      message,
      searchableCategories,
    })

    const response = await this.sendForcedToolRequest({
      context,
      instruction,
      toolPayloadObject,
    })

    if (response.hasError()) {
      return null
    }

    const functionCall = this.extractFunctionCallFromAiResponse({
      response,
      toolName: this.toolName,
    })

    if (!functionCall) {
      return null
    }

    const parsed = this.parseFunctionCallArguments({
      functionCall,
    })

    return this.normalizePlan({
      functionCall: parsed,
      searchableCategories,
    })
  }
}
```

- **Instructions embed user data in CDATA** (`<user_request><![CDATA[${message}]]></user_request>`) so
  free text cannot break the prompt structure.
- **The model's output is always re-validated in code** (e.g. `#normalizePlan()` checks every category id
  against the catalog and returns `null` if anything is off) — never trust the raw function-call arguments.
- **A non-AI action is just code**: `ExecuteSearchPlanAction` has no `toolName` and no AI turn; it
  drives `context.recordSearchService` and returns records.

## 3. The generator — build `context` and run via `InlineAgentRunner`

The loop is run **synchronously, in-process** (no Redis) by an `app/tools/<Agent>Generator.js`. The
generator assembles the `context` (all dependencies the loop and actions read), then:

```js
import {
  InlineAgentRunner,
} from '@openreachtech/mentsu-agent-loop-core'

import RecordSearchAgentLoop from '../agents/recordSearch/RecordSearchAgentLoop.js'

// inside the generator method:
const runner = InlineAgentRunner.create({
  AgentLoopCtor: RecordSearchAgentLoop,
  context: {
    ...chatContext,
    searchableCategories,
    recordSearchService: this.recordSearchService,
  },
})

const result = await runner.request({
  input: {},
  onProgress: () => {
    // phase progress is forwarded through context.notifyProgress instead
  },
})
```

The assembled `context` is exactly the object the loop reads as `this.context` and each action receives as
`context`. Its keys are the agent's dependency contract — for the record-search agent:

| Key | What it is |
| --- | --- |
| `message` | the user input / question |
| `aiAgent` | the DB agent config (instruction, model) |
| `historyMessages`, `files`, `documents` | chat history, attachments, RAG documents |
| `processor` | the LLM processor (see the `hb-multi-llm-provider` skill) |
| `searchableCategories` | the catalog the plan/execute steps work over |
| `recordSearchService` | the deterministic search/traversal service |
| `<step>AiToolId` | the `AiTool` ids the AI actions load their schema from |
| `notifyProgress` | optional progress callback (set only by the standalone worker) |

Two entrypoints on the generator are common:

- **Chat flow** (`#generate(...)`) runs a standalone **intent gate first** — it creates
  `ClassifySearchIntentAction` directly (not in the loop registry) and returns `null` when the input is
  ordinary conversation, so the loop only runs for real requests.
- **Explicit flow** (`#generateForExplicitSearch(...)`) skips the gate, passes empty history/files, and
  sets `notifyProgress` for streaming.

A `static createWithDefaults(...)` wires the concrete services so callers do not hand-assemble them.

## 4. Exposing the agent

The GraphQL mutation resolvers under `server/graphql/resolvers/user/actual/mutations/` (e.g.
`SendMessageToChatRoomMutationResolver`, `GenerateRecordFieldValuesByAiMutationResolver`) build the
processor + context and call the generator. Because the loop runs in-process via `InlineAgentRunner`, no
job/queue is involved; to run the same loop as a background job with progress streaming, use the
**`hb-agent-loop` skill** (`renchan-job` / `graphql` adapters) instead of the synchronous runner.

## Cross-cutting rules

- **All dependencies flow through `context`** — never import an AI client, model, or service inside a loop
  or action.
- **Return `null` / a fallback for missing values, not `undefined`.** Every AI step must have a
  deterministic fallback (return `null`, or a canned message) so a model failure never crashes the flow.
- **Re-validate every model output in code** before using it.
- **One class per file, one `export default`**; getters return a constant/field; the state object is
  updated immutably.
- Match the surrounding style (no semicolons, one property per line, `map`/`filter`/`reduce` over loops).

## Detail files

- [loop-and-actions.md](./references/loop-and-actions.md) — the full `RecordSearchAgentLoop` procedure and
  all four actions method-by-method, plus the `RecordFieldValuesAgentLoop` variant (branching procedure,
  no progress) to show what changes between agents.
