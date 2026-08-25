---
name: hb-light-rag
description: >
  Add lightweight retrieval-augmented generation (RAG) for AI-agent documents in a renchan backend
  without a vector database — a vector-first / LLM-fallback pipeline that ranks stored Document
  rows with an offline local embedder, plus a MySQL/MariaDB BOOLEAN-mode n-gram fulltext builder
  for keyword search. Use whenever the user asks to add or tune document retrieval for an agent,
  generate or store embeddings, or change how background knowledge is assembled into the prompt.
---

# Light RAG (vector-first / LLM-fallback document retrieval, no vector DB)

This backend does RAG "lightly" — no external vector database, no heavy embedding service. Documents live as
`Document` rows; a **local, offline embedder** produces small vectors stored in `DocumentEmbedding`;
retrieval ranks them with **in-app cosine** and falls back to an **LLM-driven id selection** when vectors
find nothing. A separate n-gram fulltext builder exists for generic MySQL/MariaDB keyword search.

## Grand principle: size the retrieval to the corpus — local vectors first, LLM fallback, no vector DB

For an agent's own document set (tens–hundreds of docs), a vector database is overkill. Rank a small set of
**offline-precomputed local vectors** with cosine in the app; only when that yields nothing, ask the model
to pick document ids from a metadata catalog.

- **Why a local, dependency-free embedder**: `LocalTextEmbedder` hashes word tokens + CJK n-grams into a
  fixed 256-dim L2-normalized vector — no network, no API cost, works offline, and (being normalized)
  cosine is just a dot product. It matches surface forms well; true semantic paraphrase is its weakness, so
  the interface can be swapped for a real embedding provider later without changing callers.
- **Why vector-first, LLM-fallback**: the vector path is cheap and deterministic; it wins whenever it
  returns a non-empty selection. Any empty result (feature disabled, no embeddings yet, all below the score
  floor, empty token budget) falls through to the LLM fetcher, which reads a metadata-only catalog and calls
  one constrained tool to choose ids. You get cheap-and-fast normally, model-smart when needed.
- **Why BASE vs DYNAMIC documents**: a `DocumentAttachmentCategory` of `BASE_KNOWLEDGE` inlines the full
  body into every prompt (small, always-relevant docs); `DYNAMIC_DOCUMENT` puts only catalog/skill metadata
  in the prompt and fetches the body **on demand** when selected. This keeps the prompt small while still
  covering a large dynamic corpus.
- **Why embeddings are offline**: generating a vector is a background job (`DocumentEmbeddingJob`), so the
  online request only *reads* precomputed vectors — retrieval stays fast and never blocks on embedding.

## Two retrieval families (mostly independent)

| Family | What it retrieves | Where |
| --- | --- | --- |
| **Document RAG** (this skill's core) | agent documents (`Document` bodies) for background knowledge | `DynamicDocumentVectorSelector` + `DynamicDocumentsBackgroundKnowledgeFetcher`, meeting at `AiAgentBaseKnowledgeAssembler` |
| **N-gram fulltext** | generic keyword rows via `MATCH ... AGAINST` | `NgramSearchWordGenerator` + `FullTextSearchConditionGenerator` |

> Record search over CRM data (not documents) goes through Elasticsearch
> (`app/ReplicaFragments/OriginObjectReplicaFragmentClient.js`) and is a **separate subsystem** — see the
> `hb-ai-agent-structure` skill's execute step. Because *document* search is not on Elasticsearch and there is no
> tokenized-document table, the document-RAG path deliberately uses pure local cosine (no lexical/RRF
> channel).

## 1. Offline embedding — `LocalTextEmbedder` + `DocumentEmbeddingJob`

`LocalTextEmbedder` (in `app/tools/embedding/`) is self-contained (no imports):

- `DIMENSION = 256`, `MODEL_VERSION = 'local-hash-ngram-v1'` (persisted with each vector to guard drift).
- `#generateTokens(text)` — NFKC-lowercase, then three token sets: word tokens (`w:`), CJK ideograph
  unigrams (`u:`), and 2/3-gram character grams (`g:`).
- `#generateEmbedding(text)` — bucket tokens by `FNV-1a hash % 256`, count collisions, L2-normalize →
  `Float32Array`.
- `#calculateCosineSimilarity(a, b)` — dot product (vectors are pre-normalized).
- `.serializeVector()` / `.deserializeVector()` — JSON ↔ `Float32Array`.

`DocumentEmbeddingJob` (a renchan-job-bullmq job; see that skill) generates vectors ahead of time:

```js
async execute (payload) {
  const document = await this.findDocument(payload)
  const sourceText = this.generateEmbeddingSourceText({ document })  // name + description + content
  const vector = this.embedder.generateEmbedding(sourceText)

  return DocumentEmbedding.upsert(
    {
      DocumentId: document.id,
      embedding: LocalTextEmbedder.serializeVector(vector),
      embeddingModelVersion: LocalTextEmbedder.MODEL_VERSION,
      embeddingDimension: LocalTextEmbedder.DIMENSION,
      savedAt: this.generateCurrentDatetime(),
    },
    {
      conflictFields: ['document_id'],
    }
  )
}
```

The online selector only *reads* `DocumentEmbedding`; it never embeds documents.

## 2. Vector path — `DynamicDocumentVectorSelector`

The primary retrieval. Constants: `TOP_K = 8`, `MINIMUM_VECTOR_SCORE = 0.01`,
`DEFAULT_MAX_TOTAL_TOKEN_COUNT = 50000` (overridable by env). The pass returns `''` at any empty step so the
assembler can fall back:

1. `#extractEligibleDocumentPrimaryKeys(...)` — the agent's DYNAMIC assignments whose document has a
   COMPLETE skill-generation outcome; `''` if none.
2. `#loadDocumentEmbeddings(...)` — `DocumentEmbedding` rows for those ids; `''` if none.
3. `queryVector = this.embedder.generateEmbedding(taskInstructionText)`.
4. `#generateVectorScores(...)` — cosine of the query vs each stored vector.
5. rank desc → `.filter(score >= MINIMUM_VECTOR_SCORE)` → `.slice(0, TOP_K)`; `''` if empty.
6. `#loadDocumentTokenCounts(...)` — estimate tokens per doc (whitespace split of name+description+content).
7. `#limitDocumentPrimaryKeysToTokenBudget(...)` — greedy accumulate within the budget (always keep the
   single top-ranked doc even if it alone exceeds it); `''` if empty.
8. `#fetchPrefetchedDynamicDocumentsPayload(...)` — `RetrieveDynamicDocumentsProcessor.process(...)` → the
   documents-by-id XML.

The token-budget reduce:

```js
const selection = rankedScores.reduce(
  (accumulated, score) => {
    const documentTokenCount = tokenCountByDocumentId.get(score.documentId)
      ?? 0
    const projectedTotalTokenCount = accumulated.totalTokenCount + documentTokenCount
    const isFirstDocument = accumulated.documentIds.length === 0
    const shouldKeepDocument = isFirstDocument
      || projectedTotalTokenCount <= maxTotalTokenCount

    const accumulatedWithDocument = {
      documentIds: [
        ...accumulated.documentIds,
        score.documentId,
      ],
      totalTokenCount: projectedTotalTokenCount,
    }

    return shouldKeepDocument
      ? accumulatedWithDocument
      : accumulated
  },
  {
    documentIds: [],
    totalTokenCount: 0,
  }
)
```

## 3. LLM fallback — `DynamicDocumentsBackgroundKnowledgeFetcher`

When the vector path returns `''`, the assembler calls the LLM fetcher: it builds a **metadata-only
catalog** (`DynamicDocumentCatalogSectionBuilder`), sends **one constrained AI turn** forcing the
`retrieve_dynamic_documents` tool (`isAutoHandleFunctionCall: false`,
`shouldPrefetchDynamicDocumentsForBackground: false` to prevent recursion), extracts and normalizes the
returned `documentIds`, intersects them with the eligible set (order preserved), and fetches bodies through
the same `RetrieveDynamicDocumentsProcessor`. The processor loads `Document` rows by id and emits
`<retrieve_dynamic_documents_result>` XML (id list + `{ document_id, document_title, document_body }` per
doc, missing ids omitted). Both paths therefore produce the **same XML shape**.

## 4. The combination seam — `AiAgentBaseKnowledgeAssembler`

`.createAsync(...)` coordinates it. It **short-circuits with an empty dynamic section unless the caller
sets `shouldPrefetchDynamicDocumentsForBackground: true`** (set by the AI-generation jobs / the document
mutation). When prefetch is on, `#resolvePrefetchedDynamicDocumentsBackgroundSectionAsync(...)` is the
vector-first / LLM-fallback core:

```js
const vectorSection = this.isDynamicDocumentVectorSelectionEnabled()
  ? await dynamicDocumentVectorSelector.fetchPrefetchedDynamicDocumentsBackgroundSectionAsync({
      aiAgentDocumentAssignments,
      employeeId,
      employeeRoleIds,
      taskInstructionText,
    })
  : ''

if (vectorSection.trim().length > 0) {
  return vectorSection
}

return this.fetchPrefetchedDynamicDocumentsBackgroundSectionViaLlmAsync({
  aiAgentDocumentAssignments,
  employeeId,
  employeeRoleIds,
  taskInstructionText,
  dynamicDocumentsBackgroundKnowledgeFetcher,
})
```

The assembler then builds the final background block: runtime datetime + **BASE-knowledge docs (full bodies
inlined)** + the **dynamic-documents section** (only when the prefetched section is non-empty, CDATA-wrapped;
the catalog is never duplicated into the final prompt). BASE vs DYNAMIC is decided by
`DocumentAttachmentCategoryId === DOCUMENT_ATTACHMENT_CATEGORY.BASE_KNOWLEDGE.ID`. This background block is
part 1 of the composed instruction — see the **`hb-ai-prompt-document-store` skill**.

## 5. N-gram fulltext (generic keyword search)

Independent of document RAG. `NgramTextTokenizer` (uses the `ngram` package) makes 2/3-gram tokens for
Japanese text (detected via a CJK regex) and passes non-Japanese text through unchanged.
`NgramSearchWordGenerator` builds a MySQL/MariaDB BOOLEAN-mode `AGAINST` string, and
`FullTextSearchConditionGenerator` wraps it into a clause:

```js
// NgramSearchWordGenerator#formatTokenGroups: AND requires each group, OR space-joins them
const formattedGroups = tokenGroups.map(tokens =>
  `(${tokens.map(token => `+${token}`).join(' ')})`
)

return this.logicalOperator === 'or'
  ? formattedGroups.join(' ')
  : formattedGroups.map(group => `+${group}`).join(' ')

// FullTextSearchConditionGenerator#generateCondition (null when the against text is empty):
`MATCH (${matchColumnNames}) AGAINST ('${againstText}' IN BOOLEAN MODE)`
```

AND → `+apple +banana`; OR → `apple banana`. Use this for generic fulltext filtering, not for agent
document RAG.

## Models

| Model (table) | Key columns | Role |
| --- | --- | --- |
| `Document` (`documents`) | `name`, `description`, `content` (the RAG body) | the document; `BackupMixinModel` → `DocumentBk` |
| `DocumentEmbedding` (`document_embeddings`) | `DocumentId`, `embedding` (JSON vector), `embeddingModelVersion`, `embeddingDimension`, `savedAt` | one vector per document (upsert on `document_id`) |
| `DocumentAttachmentCategory` | `name`, `displayName`, `displayOrder` | `BASE_KNOWLEDGE {ID:1}` (inline body) vs `DYNAMIC_DOCUMENT {ID:2}` (catalog + on-demand body) |
| `AiAgentDocumentAssignment` | `AiAgentId`, `DocumentId`, `DocumentAttachmentCategoryId` (default 1), `order` | binds a document to an agent; `order` drives assembly sort |

Eligibility for the DYNAMIC path also requires a COMPLETE `DocumentSkillGenerationOutcome`. See the
**`hb-ai-prompt-document-store` skill** for the full model set, migrations, and seeders, and the
**sequelize-model / sequelize-migration skills** for how to declare them.

## Env flags

| Env var | Read at | Default | Effect |
| --- | --- | --- | --- |
| `IS_DYNAMIC_DOCUMENT_VECTOR_SELECTION_ENABLED` | `AiAgentBaseKnowledgeAssembler` | enabled (only the literal `'false'` disables) | gate the vector-first path; disabled → straight to LLM fetcher |
| `DYNAMIC_DOCUMENT_VECTOR_SELECTION_MAX_TOKEN_COUNT` | `DynamicDocumentVectorSelector` | `50000` (used if unset / non-finite / ≤ 0) | cap total estimated tokens of selected dynamic bodies |

## Cross-cutting rules

- **Embed offline, retrieve online** — never embed a document in the request path.
- **Every empty step returns `''`** so the vector→LLM fallback composes cleanly; never throw to signal
  "nothing found".
- **Keep the embedder interface swappable** — callers depend on `#generateEmbedding` /
  `#calculateCosineSimilarity`, not on the hashing internals.
- Return `null` / `''` for missing values, not `undefined`; one class per file, `static create()` factory.

## Detail files

- [retrieval-internals.md](./references/retrieval-internals.md) — `LocalTextEmbedder` tokenization and
  hashing in full, the vector selector step methods, the LLM fetcher's catalog + constrained tool turn, the
  `RetrieveDynamicDocumentsProcessor` XML, and the n-gram tokenizer / fulltext builder details.
