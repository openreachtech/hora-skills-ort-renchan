---
name: hb-ai-prompt-document-store
description: >
  Store and compose AI-agent prompts and documents from the database rather than hard-coding them
  in a renchan backend — agent config, default and role instructions, documents, and tool schemas
  all held as data, assembled into the runtime prompt at request time and versioned through backup
  tables. Use whenever the user asks to add or change how agent instructions, roles, documents or
  tools are stored, seeded, read or written, or to model the AiAgent / Document / AiTool tables.
---

# AI Prompt & Document Store (DB-backed prompts, documents, and tools)

Every editable part of an AI agent — its instruction, its role, its attached documents, and its available
tool schemas — lives in the database, not in code. At request time a **composer** turns those rows into the
final prompt; edits are ordinary data changes, versioned by backup tables.

## Grand principle: prompts, documents, and tool schemas are versioned data; the prompt is composed at runtime

Nothing agent-facing is a string constant in code. The agent's `instruction` and `role` are DB columns; its
documents are `Document` rows linked by an assignment; its tools are JSON stored in `AiTool.payload`. A
`DocumentInstructionComposer` assembles the runtime prompt from these rows; every editable text has a `*Bk`
backup copy so history is preserved.

- **Why store prompts in the DB**: instruction/role wording changes constantly and per-agent — making it
  data means editing it is a mutation (with history), not a deploy. Seeders provide the baseline text from
  `constants/aiConstants.cjs`; runtime edits go through resolvers.
- **Why compose at runtime from parts**: a prompt is not one blob. It is **background knowledge** (RAG docs +
  runtime datetime) + **task-specific instruction** (docs + instruction for this call) + **agent preset**
  (the agent's own instruction). Composing these separately lets each source change independently and lets
  RAG (see the `hb-light-rag` skill) inject only what a task needs.
- **Why tool schemas as `AiTool.payload` JSON**: the actions in the `hb-ai-agent-structure` skill hold only a
  tool **id** and `JSON.parse(payload)` at runtime — so tool wording/parameters are data. Provider tools
  (Claude web search, Gemini googleSearch) and function-declaration tools live side by side as rows.
- **Why `*Bk` / `*StatusPhase` history**: `.save()` on a `BackupMixinModel` copies the pre-change row into
  its backup table, so the live row always holds the current value while every prior version is retained —
  you get an audit trail for free (never overwrite without it).

## The store at a glance

| Concern | Where |
| --- | --- |
| Agent identity | `AiAgent` (`name`, `description`) |
| Agent **instruction** (preset) | `AiAgentDefaultInstruction.instruction` (TEXT) → `AiAgentDefaultInstructionBk` |
| Agent **role** (system prompt) | `AiAgentRoleInstruction.role` (TEXT) → `AiAgentRoleInstructionBk` |
| Agent model | `AiAgentDefaultModel → AiModel` (see `hb-multi-llm-provider` skill) |
| Agent documents | `AiAgentDocumentAssignment` → `Document` + `DocumentAttachmentCategory` |
| Documents | `Document.content` (+ `DocumentEmbedding` / `DocumentSkill`; see `hb-light-rag` skill) → `DocumentBk` |
| Agent tools | `AiAgentAvailableAiTool` → `AiTool.payload` (JSON schema) |
| Status / history | `AiAgentLatestStatus`+`AiAgentStatusPhase`, `DocumentLatestStatus`+`DocumentStatusPhase` |

## 1. Composing the runtime prompt — `DocumentInstructionComposer`

`.createAsync(...)` wires a `TaskSpecificInstructionGenerator` and an `AiAgentBaseKnowledgeAssembler` (the
light-rag seam), plus the agent's `defaultInstruction`. `#generateComposedInstruction()` joins **three
parts** with `\n\n`, in this order:

```js
generateComposedInstruction () {
  const taskSpecificInstruction = this.taskSpecificInstructionGenerator.generateInstruction()
  const backgroundKnowledge = this.aiAgentBaseKnowledgeAssembler.generateBackgroundKnowledge()
  const defaultInstruction = this.generateDefaultInstruction()

  return [
    backgroundKnowledge,     // 1. runtime datetime + BASE docs (inlined) + dynamic doc bodies (RAG)
    taskSpecificInstruction, // 2. this call's documents + instruction
    defaultInstruction,      // 3. the agent preset
  ]
    .join('\n\n')
}
```

The parts are XML-wrapped so the model can tell them apart:

- **Part 3 — agent preset**: `<instruction><agent_preset>${defaultInstruction}</agent_preset></instruction>`.
- **Part 2 — task-specific** (`TaskSpecificInstructionGenerator#generateInstruction`): a `<documents>` block
  (`<document index=N><source>…</source><content>…</content></document>`) followed by
  `<instruction>${instruction}</instruction>`. Its documents are loaded from the DB by id
  (`Document.findAll`) plus any one-time documents, sorted by `order`.
- **Part 1 — background knowledge** (`AiAgentBaseKnowledgeAssembler`): runtime datetime + BASE-knowledge
  document bodies inlined + the dynamic-documents section (RAG) when prefetch selected any. This is the
  `hb-light-rag` skill's output.

## 2. Exporting an agent as a document — `#generateAiAgentDocument()`

The same composer also renders a **Markdown** document (used by the export mutation), created with the three
generator deps `null` — only the formatting methods are used:

```
# AI Agent: <name>

<description>

## Default Instructions

<AiAgentDefaultInstruction.instruction>

## Attached Documents

### Document 1: <name>

*<description>*

<content>
```

`#formatAttachedDocuments()` sorts `AiAgentDocumentAssignments` by `order`, or emits "*No documents
attached*".

## 3. The models — prompts vs documents

All extend `BaseAppRenchanModel`, attributes via `ModelAttributeFactory` (`factory.ID_BIGINT` for
entities/junctions, `factory.ID_INTEGER` for small status lookups). See the **`hb-sequelize-model` skill** for
the declaration conventions.

**Prompt / agent:**

| Model | Key columns | Notable |
| --- | --- | --- |
| `AiAgent` | `name`, `description`, `registeredAt`, `savedAt` | hasOne `AiAgentDefaultInstruction`/`AiAgentRoleInstruction`/`AiAgentDefaultModel`/`AiAgentLatestStatus`; hasMany `AiAgentDocumentAssignment`/`AiAgentAvailableAiTool` |
| `AiAgentDefaultInstruction` | `AiAgentId`, `instruction` (TEXT), `savedAt` | `BackupMixinModel` → `AiAgentDefaultInstructionBk` |
| `AiAgentRoleInstruction` | `AiAgentId`, `role` (TEXT), `savedAt` | `BackupMixinModel` → `AiAgentRoleInstructionBk` (the system prompt) |
| `AiAgentDefaultModel` | `AiAgentId`, `AiModelId`, `savedAt` | model selection (`hb-multi-llm-provider` skill) |
| `AiAgentDocumentAssignment` | `AiAgentId`, `DocumentId`, `DocumentAttachmentCategoryId` (default 1), `order` | binds documents; BASE vs DYNAMIC + `order` |
| `AiAgentAvailableAiTool` | `AiAgentId`, `AiToolId`, `isEnabled`, `isDefault` | which tools the agent may use |
| `AiAgentDocumentInstructionRecord` | `DocumentId`, `AiAgentId`, `instruction` (TEXT) | per-document instruction override |

**Document:**

| Model | Key columns | Notable |
| --- | --- | --- |
| `Document` | `name`, `description`, `content` (TEXT, the body), `generatedAt` | `BackupMixinModel` → `DocumentBk`; hasOne `DocumentEmbedding`/`DocumentSkill` (`hb-light-rag` skill) |
| `DocumentAttachmentCategory` | `name`, `displayName`, `displayOrder` | `BASE_KNOWLEDGE {ID:1}` (body inlined) vs `DYNAMIC_DOCUMENT {ID:2}` (catalog only) |
| `DocumentSkill` | `DocumentId`, `skillName`, `skillCoverageDescription`, `contextHint` | `BackupMixinModel` → `DocumentSkillBk`; drives dynamic catalog |

**Tool:**

| Model | Key columns | Notable |
| --- | --- | --- |
| `AiTool` | `name`, `description`, `payload` (TEXT, **stringified JSON schema**), `isVisible`, `displayOrder` | no associations; loaded by PK + `JSON.parse(payload)` at runtime |

### The `*Bk` / `*StatusPhase` history pattern

`AiAgentRoleInstruction` declares `static get Mixins () { return [BackupMixinModel] }` and
`static get BackupModel () { return this._.AiAgentRoleInstructionBk }`. The `*Bk` model is a plain
`BaseAppRenchanModel` with **identical columns** and no mixin — the write-once history sink. On `.save()`
the mixin copies the pre-change row into `*Bk`. Same for `AiAgentDefaultInstruction`, `Document`,
`DocumentSkill`. A variant: `AiAgentLatestStatus` / `DocumentLatestStatus` use `BackupMixinModel` but point
`BackupModel` at the `*StatusPhase` table — every status change appends a phase row while the LatestStatus
row is mutated in place. **This is why writes use `.save()`, never `.update()`** (see the sequelize-model
skill).

## 4. `AiTool.payload` — tool schemas as data

Tool schemas are `JSON.stringify`-ed into `AiTool.payload` by seeders and `JSON.parse`-d at runtime:

- **Provider tools** (`sequelize/seeders/master/…-ai_tools_related.cjs`): e.g. Claude
  `JSON.stringify({ type: 'web_search_20250305', name: 'web_search' })`, OpenAI
  `{ type: 'web_search_preview' }`, Gemini `{ googleSearch: {} }`.
- **Function-calling tools** (from `constants/aiRecordSearchToolsConstants.cjs`): full
  function-declaration objects (`{ name, description, parameters: { type, properties, required } }`)
  stringified into `payload`, seeded with `is_visible: false` (internal forced tools — see the
  `hb-ai-agent-structure` skill).

Runtime read (in an action): `const aiTool = await AiTool.findByPk(aiToolId); JSON.parse(aiTool.payload)`.
Agent↔tool binding is `AiAgentAvailableAiTool`; model↔tool availability is `AiModelToolAssignment`.

## 5. Seeders — master / dev-master / development

Three tiers under `sequelize/seeders/` (see the **sequelize-seeder skill**):

- **`master/`** — production baseline: the built-in system-worker agents and the AI-tools rows.
- **`dev-master/`** — the same data duplicated for the dev DB (identical filenames).
- **`development/`** — sample/demo rows with high fixed ids (`documents-id1000`, `ai_agents-id50000`).

Pattern: `TimestampSeedsSupplier.supplyAll(rows)` + `queryInterface.bulkInsert`; `down` = `bulkDelete` by
id. **Prompt text comes from `constants/aiConstants.cjs` → `DEFAULT_AI_AGENT.*`** — each entry has
`ID`, `NAME`, `DESCRIPTION`, `DEFAULT_INSTRUCTION` (→ `ai_agent_default_instructions.instruction`),
`ROLE_INSTRUCTION` (→ `ai_agent_role_instructions.role`). A single agent seeder wires ~10 tables (agent,
default/role instruction, latest status + status phase, default model, avatar, role category, emotional
level). See the **`hb-constant-definition` skill** for the `.cjs` constants rule.

## 6. Reading and writing (resolvers)

Schema `server/graphql/schemas/user/019-aiAgent.graphql` — queries `aiAgent` / `aiAgents` / `aiModels`;
mutations `addAiAgent` / `updateAiAgent` / `updateAiAgentStatus` / `exportAiAgentInstructionDocument` /
`generateDocumentByAiAgent`.

- **Read** (`AiAgentQueryResolver`): `AiAgent.findOne` with a deep `include` (LatestStatus, DefaultModel,
  AvailableAiTool→AiTool `where isVisible`, DocumentAssignment→Document + DocumentAttachmentCategory
  ordered by `order`, `AiAgentDefaultInstruction`, `AiAgentRoleInstruction`, …); `#formatResponse()` exposes
  `instruction` (from `AiAgentDefaultInstruction.instruction`) and `role` (from `AiAgentRoleInstruction.role`).
  The list resolver omits the instruction bodies. See the **`hb-query-resolver` skill**.
- **Write** (`AddAiAgentMutationResolver` / `UpdateAiAgentMutationResolver`): one transaction; build a nested
  `AiAgent.build({ AiAgentDefaultInstruction: { instruction }, AiAgentRoleInstruction: { role },
  AiAgentDocumentAssignments: [...], AiAgentDefaultModel, AiAgentLatestStatus })` with cascading `include`,
  then bulk-create `AiAgentAvailableAiTool`. Update uses `.set(...)` + `await
  builtAiAgent.AiAgentDefaultInstruction.save()` / `.AiAgentRoleInstruction.save()` (**these `.save()` calls
  trigger the `*Bk` backup**), then destroy+recreate the assignment/tool rows. Verify requested tools belong
  to the model (`AiModelToolAssignment`). See the **`hb-mutation-resolver` skill**.
- **Export** (`ExportAiAgentInstructionDocumentMutationResolver`): loads the agent, in a transaction calls
  `DocumentInstructionComposer.create({ ...: null }).generateAiAgentDocument({ aiAgent })`, persists a
  `Document` (status DRAFT), and **after commit** dispatches `DocumentEmbeddingDispatcher` +
  `DocumentSkillSnapshotDispatcher` jobs so the exported document is indexed for later dynamic retrieval
  (`hb-light-rag` skill; jobs via the `hb-renchan-job-bullmq` skill).

## Cross-cutting rules

- **No agent-facing text as a code constant** — instruction/role/document/tool text is DB data; baseline
  comes from seeders.
- **Write editable text with `.save()` on the backup-mixin model**, never `.update()`, so history is
  captured; wrap multi-table writes in one transaction.
- **Compose the prompt at runtime from the three parts** — do not concatenate a prompt by hand in a resolver.
- Return `null` for missing values, not `undefined`; one class per file; migrations use snake_case `field:`
  names (see the `hb-sequelize-migration` skill).

## Detail files

- [models-and-composition.md](./references/models-and-composition.md) — every prompt/document/tool model
  with columns and associations, the `*Bk` / `*StatusPhase` mechanics, the full composed-instruction and
  exported-document skeletons, and the seeder wiring from `DEFAULT_AI_AGENT`.
