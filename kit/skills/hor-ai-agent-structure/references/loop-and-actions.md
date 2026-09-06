# Loop and actions in full (record-search + record-field-values agents)

Referenced from `SKILL.md`. This walks the two concrete agents method-by-method so a new agent can be
modeled on them. The core-package members (`ProceduralAgentLoop`, `BaseAgentAction`, `AgentActionRegistry`,
`InlineAgentRunner`) belong to the `hor-agent-loop` skill; here we only show how the app uses them.

## Record-search agent — the linear `plan → execute → compose` procedure

`RecordSearchAgentLoop extends ProceduralAgentLoop`. Overrides, in order:

- `#get:maxIterations` → `4` (the procedure normally completes in one iteration; the cap is a safety net).
- `#get:registry` → `AgentActionRegistry.create({ actions: [PlanSearchAction.create(), ExecuteSearchPlanAction.create(), ComposeAnswerAction.create()] })`. **`ClassifySearchIntentAction` is intentionally not here** — it is the gate, run by the generator before the loop.
- `#createInitialState({ input })` → `{ result: null }` (`input` unused).
- `#advanceState({ state })` — the body:
  1. progress `plan_search / started`
  2. `plan = await this.performAction({ name: 'planSearch', argumentHash: { message, searchableCategories }, context })`
  3. `if (!plan)` → return a canned "couldn't understand" result with empty `targetRecords` (deterministic branch, no more AI)
  4. progress plan completed / execute started; `executed = await this.performAction({ name: 'executeSearchPlan', argumentHash: { plan }, context })`
  5. progress execute completed (`foundCount`) / compose started; `answer = await this.performAction({ name: 'composeAnswer', argumentHash: { message, resultSummary: { foundCount, isTruncated, resultCategoryName } } })`
  6. return `{ ...state, result: { message: answer.message, targetRecords: executed.targetRecords } }`
- `#isComplete({ state })` → `Boolean(state.result)`.
- `#buildResult({ state })` → `state.result`.

Helpers: `#resolveCategoryName({ originObjectCategoryId })` looks the name up in `context.searchableCategories`
(`matched?.name ?? null`); `#notifyProgress({ phase, status, foundCount = null })` calls
`this.context.notifyProgress?.(...)` (no-op in the chat flow, wired only by the standalone search worker).

### The four actions

All extend `BaseRecordSearchAgentAction` (which holds the forced-tool helpers from `SKILL.md`). Each AI
action overrides `#get:name`, `#get:description`, `#get:toolName`, and `#run()`.

| Action | `name` | `toolName` | AI? | `#run()` returns |
| --- | --- | --- | --- | --- |
| `ClassifySearchIntentAction` | `classifySearchIntent` | `classify_search_intent` | yes | `boolean` (`parsed?.isRecordSearch === true`); `false` on any failure |
| `PlanSearchAction` | `planSearch` | `plan_record_search` | yes | `RecordSearchPlan \| null` (validated) |
| `ExecuteSearchPlanAction` | `executeSearchPlan` | — | **no** | `{ targetRecords, isTruncated, resultOriginObjectCategoryId }` |
| `ComposeAnswerAction` | `composeAnswer` | `compose_search_answer` | yes | `{ message }` (always — fallback if AI fails) |

- **`ClassifySearchIntentAction#run()`** — loads its tool (`context.classifySearchIntentAiToolId`); on
  missing tool / `response.hasError()` / no function call → `false`; else parse and return
  `parsed?.isRecordSearch === true`. The gate defaults to "not a search" whenever anything is uncertain.
- **`PlanSearchAction#run()`** — forced-tool flow, then `#normalizePlan({ functionCall, searchableCategories })`.
  Normalization is strict: every step's category id must be in the catalog `Set`; the plan must be
  non-empty; the first step must be `kind: 'anchor'`; `resultStepIndex` must be in range; an
  `association` step's `fromStepIndex` must reference an earlier step (`0 <= fromStepIndex < index`, 1-hop
  only). Any violation → `null`, which the loop turns into the "couldn't understand" branch.
- **`ExecuteSearchPlanAction#run()`** — **no AI**. `#executeSteps()` runs the steps sequentially with a
  `reduce` over `Promise.resolve([])`, threading prior results; an `anchor` step calls
  `context.recordSearchService.searchAnchorRecords({ originObjectCategoryId, keyword })`, an `association`
  step calls `context.recordSearchService.findAssociatedRecords({ targetOriginObjectCategoryId, sourceRecords })`
  using `priorResults[step.fromStepIndex]`. It then picks `stepResults[plan.resultStepIndex]`.
- **`ComposeAnswerAction#run()`** — computes a deterministic `#buildFallbackMessage()` first, loads its
  tool, and returns `{ message: parsed.message }` only when the AI produced a non-empty string; otherwise
  returns `{ message: fallbackMessage }`. **This step never returns null** — the user always gets a reply.

### Instruction building (shared shape)

Each AI action's `#buildInstruction(...)` joins a `lines` array with `\n` and embeds user/catalog data in
CDATA blocks, e.g. `<user_request><![CDATA[${message}]]></user_request>` and
`<searchable_categories>${categoriesJson}</searchable_categories>`, and states "call the tool `<toolName>`
exactly once." Serialized catalogs carry only the minimum fields (`originObjectCategoryId`, `name`).

## Record-field-values agent — a branching `narrow → search → fill` procedure

`RecordFieldValuesAgentLoop extends ProceduralAgentLoop` follows the same skeleton but shows what varies
between agents:

- `#get:maxIterations` → `3`.
- `#get:registry` → `SelectSearchTargetsAction`, `SearchEditOptionsAction`, `FillFormAction`.
- `#createInitialState()` → `{ searchedOptionsByColumnId: {}, result: null }` (richer than record-search).
- `#advanceState()` has **conditional branches** (not a fixed linear chain):
  - `searchableColumns = context.editableColumns.filter(column => column.searchOption?.hasTextSearch === true)`
  - `targets` = `[]` when there are no searchable columns, else `selectSearchTargets`
  - `searchedOptionsByColumnId` = `{}` when there are no targets, else `searchEditOptions`
  - always `filled = fillForm({ message, editableColumns, currentValues, fixedOptionsByColumnId, searchedOptionsByColumnId })`
  - returns `{ ...state, searchedOptionsByColumnId, result: filled }` where `filled` is `{ message, updateValues }`
- `#isComplete()` / `#buildResult()` identical to record-search.
- **No `notifyProgress`** — this agent does not emit phase progress.
- Context keys used: `editableColumns`, `message`, `currentValues`, `fixedOptionsByColumnId` (vs
  record-search's `message`, `searchableCategories`, `notifyProgress`).

The takeaway: the **skeleton is fixed** (six overridden members, immutable state, actions matched by
`name`), and what an agent customizes is the **procedure in `#advanceState()`**, the **action set in
`#get:registry`**, and the **context keys** its steps read.

## The forced-single-tool turn (shared by every AI action)

The pattern, provided once on the app base and reused by all AI actions:

1. `toolPayloadObject = await this.loadToolPayloadObject({ aiToolId })` — the tool JSON from the `AiTool`
   table (see the `hor-ai-prompt-document-store` skill); `null` guards the step.
2. `instruction = this.buildInstruction(...)` — CDATA-wrapped user data + "call `<toolName>` once".
3. `response = await this.sendForcedToolRequest({ context, instruction, toolPayloadObject })` — one turn
   with `isAutoHandleFunctionCall: false`, `toolChoices: [{ name }]`, `tools: [toolPayloadObject]` (see the
   `hor-multi-llm-provider` skill for `context.processor.sendRequestToAi`).
4. `if (response.hasError())` → fallback/`null`.
5. `functionCall = this.extractFunctionCallFromAiResponse({ response, toolName })` → `null` guard.
6. `parsed = this.parseFunctionCallArguments({ functionCall })` → the typed step output, then
   **re-validated in code** before use.
