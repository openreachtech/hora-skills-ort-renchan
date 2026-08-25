# Retrieval internals (embedder, selectors, processor, n-gram)

Referenced from `SKILL.md`. The exact internals behind the vector-first / LLM-fallback document RAG and the
n-gram fulltext builder.

## `LocalTextEmbedder` (`app/tools/embedding/LocalTextEmbedder.js`)

Self-contained, no imports. Turns text into a fixed-dim L2-normalized vector so cosine == dot product.

- `DIMENSION = 256`, `MODEL_VERSION = 'local-hash-ngram-v1'`.
- `.generateHash(token)` — FNV-1a 32-bit: seed `0x811c9dc5`, per char `Math.imul(hash ^ charCode,
  0x01000193)`, returned `>>> 0`.
- `#generateTokens(text)` — NFKC + lowercase, then:
  - **word tokens**: `text.split(/[^0-9a-zÀ-ɏ]+/u)`, keep length ≥ 2, prefix `w:`.
  - **ideograph unigrams**: from whitespace-stripped `compactText`, chars with codepoint ≥ `0x3400`, prefix
    `u:`.
  - **character grams**: sliding windows of size `[2, 3]` over `compactText`, prefix `g:`.
- `#generateEmbedding(text)`:

```js
const bucketCounts = this.generateTokens(text).reduce(
  (counts, token) => {
    const bucketIndex = Ctor.generateHash(token) % dimension

    counts.set(bucketIndex, (counts.get(bucketIndex) ?? 0) + 1)

    return counts
  },
  new Map()
)

const rawVector = Array.from({ length: dimension }, (each, index) => bucketCounts.get(index) ?? 0)
const sumOfSquares = rawVector.reduce((sum, value) => sum + value * value, 0)
const norm = Math.sqrt(sumOfSquares) || 1

return Float32Array.from(rawVector, value => value / norm)
```

- `#calculateCosineSimilarity(vectorA, vectorB)` — `vectorA.reduce((sum, value, index) => sum + value *
  vectorB[index], 0)` (dot product; both are pre-normalized).

The `Map` here is a local accumulator inside one method (a legitimate collection use), not per-instance
mutable state.

## `DynamicDocumentVectorSelector` step methods

`#fetchPrefetchedDynamicDocumentsBackgroundSectionAsync(...)` runs the 8 steps in `SKILL.md`; the helpers:

- `#extractEligibleDocumentPrimaryKeys(...)` → delegates to
  `DynamicDocumentCatalogSectionBuilder#extractEligibleDynamicDocumentPrimaryKeys` (DYNAMIC assignments with
  a `Document` whose `DocumentSkillGenerationOutcome` is COMPLETE).
- `#loadDocumentEmbeddings(...)` → `DocumentEmbedding.findAll({ where: { DocumentId: { [Op.in]: ids } } })`.
- `#generateVectorScores(...)` → per row `{ documentId, score: embedder.calculateCosineSimilarity(query,
  LocalTextEmbedder.deserializeVector(row.embedding)) }`.
- `#rankVectorScores(...)` → sort by descending `score`.
- `#loadDocumentTokenCounts(...)` → load `id, name, description, content`, return `Map<id,
  estimatedTokenCount>`.
- `#estimateDocumentTokenCount(...)` → join name+description+content with `\n`, split on `/\s+/u`, count
  non-empty (a dependency-free proxy — do not confuse with `tiktoken`).
- `#limitDocumentPrimaryKeysToTokenBudget(...)` → the greedy reduce in `SKILL.md` (always keep the top-ranked
  doc).
- `#fetchPrefetchedDynamicDocumentsPayload(...)` → `RetrieveDynamicDocumentsProcessor.process({ contextHint:
  null, documentIds, extraToolOptions: { employeeId, employeeRoleIds } })`.

`.MAX_TOTAL_TOKEN_COUNT` reads `process.env.DYNAMIC_DOCUMENT_VECTOR_SELECTION_MAX_TOKEN_COUNT`, falling back
to `DEFAULT_MAX_TOTAL_TOKEN_COUNT = 50000` when not finite or ≤ 0.

## `DynamicDocumentsBackgroundKnowledgeFetcher` (LLM fallback)

- Provider→tool-id map: `.retrieveDynamicDocumentsAiToolIdsByProvider` → `{ claude, gemini, openai }` from
  `CONTEXT_ASSEMBLER_DYNAMIC_DOCUMENT.AI_TOOL.RETRIEVE_DYNAMIC_DOCUMENTS_*.ID`; tool name
  `'retrieve_dynamic_documents'`.
- `#buildDynamicDocumentSelectionArguments(...)` — resolve eligible keys, load the prefetch worker agent
  (`AiAgent.findByPk(DEFAULT_AI_AGENT.AI_AGENT_FOR_DYNAMIC_DOCUMENT_BODY_PREFETCH.ID, { include: [...] })`),
  pick the processor by its default model (see the `hb-multi-llm-provider` skill), resolve the provider-specific
  `AiTool` id, `JSON.parse` its `payload`, build the metadata catalog + instruction.
- `#sendDynamicDocumentSelectionRequestAsync(...)` — one `processor.sendRequestToAi(...)` with
  `toolChoices: [{ name: 'retrieve_dynamic_documents' }]`, `isAutoHandleFunctionCall: false`,
  `shouldPrefetchDynamicDocumentsForBackground: false` (recursion guard).
- `#extractRetrieveDynamicDocumentsFunctionCall(...)` → `#normalizeRetrieveToolInvocationDocumentIds(...)`
  (`arguments.documentIds` → `Number`s) → `#filterDocumentPrimaryKeysToCatalogSubset(...)` (intersect with
  the eligible set, order preserved) → `''` if empty, else fetch the payload.
- The instruction (`#buildDynamicDocumentBodyPrefetchInstruction`) lists the allowed `document_id` values
  and requires exactly one tool call returning a non-empty integer array.

## `DynamicDocumentCatalogSectionBuilder`

Builds the `<dynamic_document_catalog>` metadata block (no bodies) and the shared eligibility rule
(`#extractEligibleDynamicDocumentPrimaryKeys`, used by **both** selectors): an assignment must be DYNAMIC
category, have a `Document`, and that document's skill-generation outcome must be COMPLETE
(`DocumentSkillGenerationStatusId === DOCUMENT_SKILL_GENERATION_STATUS.COMPLETE.ID`).

## `RetrieveDynamicDocumentsProcessor` (retrieval leaf)

`#get:aiToolName` = `'retrieve_dynamic_documents'`. `#process(...)` validates → normalizes ids →
`Document.findAll({ where: { id: { [Op.in]: ids } } })` → maps by PK → emits, in request order (missing ids
omitted):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<retrieve_dynamic_documents_result>
  <document_ids>
    <document_id>{id}</document_id>
  </document_ids>
  <documents>
    <document>
      <document_id>{id}</document_id>
      <document_title>{escaped name}</document_title>
      <document_body>{escaped content}</document_body>
    </document>
  </documents>
</retrieve_dynamic_documents_result>
```

(Phase-1 note in the code: per-document ACL is intentionally omitted here and restored later; documents are
returned by id in request order.) The assembler CDATA-wraps this XML into the background block.

## N-gram tokenizer and fulltext builder

`NgramTextTokenizer` (`app/tools/TextTokenizer/`) — uses the `ngram` package.

- `.create()` defaults `minNgram = 2, maxNgram = 3`; `.createAsync()` defaults `minNgram = 2, maxNgram = 2`.
- `#isJapaneseText({ text })` — resets `REGEX.JAPANESE.lastIndex` then `.test(text)`; the regex covers
  hiragana/katakana/kanji/fullwidth forms and select symbols.
- `#tokenizeSentence(sentence)` — `''` for empty; **returns non-Japanese text unchanged**; else
  `[...new Set(this.tokenizer.ngram(sentence, minNgram, maxNgram))].join(' ')`.

`NgramSearchWordGenerator` (`app/tools/FullTextSearch/NgramSearchKeywordGenerator.js` — class name differs
from the filename):

- `.create()` defaults `nGramLength = 2, logicalOperator = 'and'`.
- `#splitToWords()` — replace BOOLEAN-mode operator chars `/[+\-*()<>~'"@[\]{}]/ug` with spaces, split on
  `/\s+/u`.
- `#generateTokenGroups({ words })` — short words (`length < nGramLength`) become single-token groups; long
  words are n-grammed, filtered to grams the word actually `includes` (drops padding), deduped per word.
- `#formatTokenGroups(...)` — the AND/OR formatting in `SKILL.md`.

`FullTextSearchConditionGenerator` — `#generateCondition()` returns
`MATCH (${matchColumnNames}) AGAINST ('${againstText}' IN BOOLEAN MODE)`, or `null` when the against text is
empty; `#formatAgainstText()` delegates to `NgramSearchWordGenerator`.

This n-gram/fulltext infra is generic MySQL/MariaDB fulltext and is **not** wired into the document-RAG
selectors.
