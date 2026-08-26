# Models and composition (full)

Referenced from `SKILL.md`. The exact model shapes, the backup/history mechanics, the composed-prompt and
exported-document skeletons, and the seeder wiring.

## Composed runtime prompt — the three XML parts

`DocumentInstructionComposer#generateComposedInstruction()` joins with `\n\n`, in order: background
knowledge → task-specific → agent preset.

- **Agent preset** (`#generateDefaultInstruction()`):
  `<instruction><agent_preset>${this.defaultInstruction}</agent_preset></instruction>`.
- **Task-specific** (`TaskSpecificInstructionGenerator#generateInstruction()`):

  ```
  attached documents for this task:
  <documents>
  <document index=0>
  <source>${name}</source>
  <content>${content}</content>
  </document>
  </documents>
  Instruction for this task:
  <instruction>
  ${this.instruction}
  </instruction>
  ```

  Documents are loaded by id (`Document.findAll({ where: { id } })`) plus one-time docs (named
  `Additional Reference N`), sorted by `order`.
- **Background knowledge** (`AiAgentBaseKnowledgeAssembler#assembleCombinedBackgroundSection()`, joined with
  `\n\n`, empties filtered):
  - runtime datetime:
    `<runtime_context>\n<current_datetime_iso>${iso}</current_datetime_iso>\n</runtime_context>`
  - BASE-knowledge docs (bodies inlined) preceded by the legacy delimiter line
    `----Please remember the content of the document below as prior knowledge, and then respond to the
    instructions-----`, then a `<documents>…<document index=N><source>…</source><content>…</content>
    </document>…</documents>` block.
  - dynamic docs (only when prefetch selected any):
    `<dynamic_documents_retrieved_for_background>\n<![CDATA[${payload}]]>\n
    </dynamic_documents_retrieved_for_background>` — the payload is the `hor-light-rag` skill's
    `<retrieve_dynamic_documents_result>` XML.

  BASE vs DYNAMIC is decided by `DocumentAttachmentCategoryId ===
  DOCUMENT_ATTACHMENT_CATEGORY.BASE_KNOWLEDGE.ID`.

## Exported Markdown document

`#generateAiAgentDocument({ aiAgent })` (composer built with all three deps `null`):

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

`#formatAttachedDocuments()` sorts `AiAgentDocumentAssignments` by `order`, else "*No documents attached*".

## Prompt / agent models (columns + associations)

- `AiAgent` — `name` STRING(191), `description` TEXT, `registeredAt`/`savedAt`/`lastModifiedAt`,
  `CreatedByUserId`/`LastModifiedByUserId`. hasOne: `AiAgentLatestStatus`, `AiAgentDefaultInstruction`,
  `AiAgentRoleInstruction`, `AiAgentAvatarUrl`, `AiAgentRoleCategory`, `AiAgentEmotionalLevel`,
  `AiAgentDefaultModel`. hasMany: `AiAgentStatusPhase`, `AiAgentAvailableAiTool`, `AiAgentTagAssignment`,
  `AiAgentDocumentAssignment`, `AiAgentDocumentInstructionRecord`. belongsToMany `AiAgentTag`, and `Document`
  as `GeneratedDocuments` via `AiAgentDocumentGeneration`.
- `AiAgentDefaultInstruction` — `AiAgentId`, `instruction` TEXT, `savedAt`; belongsTo `AiAgent`;
  `BackupMixinModel` → `AiAgentDefaultInstructionBk`.
- `AiAgentRoleInstruction` — `AiAgentId`, `role` TEXT, `savedAt`; belongsTo `AiAgent`; `BackupMixinModel` →
  `AiAgentRoleInstructionBk`. (`role` is the provider system prompt — see the `hor-multi-llm-provider` skill's
  payload generators.)
- `AiAgentDefaultModel` — `AiAgentId`, `AiModelId`, `savedAt`; belongsTo `AiAgent`, `AiModel`.
- `AiAgentAvailableAiTool` — `AiAgentId`, `AiToolId`, `isEnabled` BOOL, `isDefault` BOOL, `savedAt`;
  belongsTo `AiAgent`, `AiTool`.
- `AiAgentDocumentAssignment` — `AiAgentId`, `DocumentId`, `DocumentAttachmentCategoryId` (default 1),
  `order` INT, `savedAt`; belongsTo `AiAgent`, `Document`, `DocumentAttachmentCategory`.
- `AiAgentDocumentInstructionRecord` — `DocumentId`, `AiAgentId`, `instruction` TEXT, `savedAt`.
- `AiAgentStatus` — `ID_INTEGER`, `name`, `description` STRING(191); hasMany `AiAgentLatestStatus`,
  `AiAgentStatusPhase`.
- `AiAgentLatestStatus` — `AiAgentId`, `AiAgentStatusId` INT, `savedAt`; belongsTo `AiAgent`,
  `AiAgentStatus`; subquery `?AiAgentStatusId.AiAgentId`; `BackupMixinModel` → `AiAgentStatusPhase`.
- `AiAgentStatusPhase` — `AiAgentId`, `AiAgentStatusId` INT, `savedAt` (the status history sink).

## Document models (columns + associations)

- `Document` — `name` STRING(191), `description` TEXT, `content` TEXT (the body), `generatedAt`,
  `savedAt`/`lastModifiedAt`, `CreatedByUserId`/`LastModifiedByUserId`. hasOne `DocumentLatestStatus`,
  `DocumentSkill`, `DocumentSkillGenerationOutcome`, `DocumentEmbedding`; hasMany `DocumentStatusPhase`,
  `AiAgentDocumentAssignment`, `AiAgentDocumentInstructionRecord`, `AiAgentDocumentGeneration`,
  `AiChatRoomMessageDocumentLinkage`; `BackupMixinModel` → `DocumentBk`.
- `DocumentEmbedding` — `DocumentId`, `embedding` TEXT, `embeddingModelVersion` STRING(191),
  `embeddingDimension` INT, `savedAt` (`hor-light-rag` skill).
- `DocumentSkill` — `DocumentId`, `skillName` STRING(191), `skillCoverageDescription` TEXT, `contextHint`
  TEXT, `generatedAt`; `BackupMixinModel` → `DocumentSkillBk`.
- `DocumentAttachmentCategory` — `name`, `description`, `displayName` STRING(191), `displayOrder` INT;
  hasMany `AiAgentDocumentAssignment`.
- `DocumentStatus` — `ID_INTEGER`, `name`, `description`; hasMany `DocumentLatestStatus`,
  `DocumentStatusPhase`.
- `DocumentLatestStatus` — `DocumentId`, `DocumentStatusId` INT, `savedAt`; `BackupMixinModel` →
  `DocumentStatusPhase`.
- `DocumentStatusPhase` — `DocumentId`, `DocumentStatusId` INT, `savedAt`.

## Tool model

- `AiTool` — `name` STRING(191), `description` STRING(191), `payload` TEXT (NOT NULL, stringified JSON
  schema), `displayOrder` INT (default 0), `isVisible` BOOL (default true), `savedAt`; `associate()` is
  noop. Migration `…-create_table-ai_tools.cjs` → table `ai_tools`, column `payload` TEXT NOT NULL.
- `AiModelToolAssignment` (join) — `AiModelId`, `AiToolId`, `savedAt` (model↔tool availability).

## The `*Bk` / `*StatusPhase` mechanics

- A backed-up model declares `static get Mixins () { return [BackupMixinModel] }` and
  `static get BackupModel () { return this._.<Name>Bk }`. The `*Bk` model has identical columns, no mixin,
  no `BackupModel` — the write-once sink. `.save()` copies the pre-change row into `*Bk`.
- Status variant: `AiAgentLatestStatus` / `DocumentLatestStatus` set `BackupModel` to the `*StatusPhase`
  table — each change appends a phase row while the latest row is updated in place. Subqueries like
  `?AiAgentStatusId.AiAgentId` filter agents by current status.
- Consequence: **always `.save()` on these models, never `.update()`** — `.update()` can bypass the mixin and
  lose history / miss columns.

## Seeder wiring from `DEFAULT_AI_AGENT`

`constants/aiConstants.cjs` → `DEFAULT_AI_AGENT` is keyed by well-known agent; each entry:
`{ ID, NAME, DESCRIPTION, DEFAULT_INSTRUCTION, ROLE_INSTRUCTION }`. A master agent seeder (e.g.
`…-ai_agent_for_document_skill_snapshot.cjs`) `require`s it and seeds across ~10 tables in one file:

- `ai_agents` (`name`/`description` from the entry)
- `ai_agent_default_instructions` — `instruction: DEFAULT_AI_AGENT.<KEY>.DEFAULT_INSTRUCTION`
- `ai_agent_role_instructions` — `role: DEFAULT_AI_AGENT.<KEY>.ROLE_INSTRUCTION`
- `ai_agent_latest_statuses` + `ai_agent_status_phases` (from `AI_AGENT_STATUS`)
- `ai_agent_default_models` (an `AI_MODEL.*.ID`)
- plus `ai_agent_avatar_urls`, `ai_agent_role_categories`, `ai_agent_emotional_levels`,
  `ai_agent_tag_assignments`

Tool seeders: `…-ai_tools_related.cjs` seeds `ai_tools` + `ai_model_tool_assignments` (Claude→Anthropic
models, OpenAI→OpenAI, Gemini→Google, from `AI_MODEL` provider ids); `…-ai_tools-record-search.cjs` seeds
`ai_tools` only, payloads from `aiRecordSearchToolsConstants.cjs`, `is_visible: false`. Document seeder
(`development/…-documents-id1000.cjs`) seeds `documents` (markdown `content`) then derives
`document_latest_statuses` + `document_status_phases` (`DOCUMENT_STATUS.ACTIVE.ID`).

Relevant limits/categories in `aiConstants.cjs`: `AI_AGENT` (`MAX_INSTRUCTION_LENGTH: 10000`,
`MAX_ROLE_LENGTH: 200`, `MAX_NAME_LENGTH: 50`, `MAX_DESCRIPTION_LENGTH: 500`),
`DOCUMENT_ATTACHMENT_CATEGORY` (`BASE_KNOWLEDGE {ID:1}` / `DYNAMIC_DOCUMENT {ID:2}`), `DOCUMENT_STATUS`,
`AI_AGENT_STATUS`.
