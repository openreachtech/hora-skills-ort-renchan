# Skills

A catalog of every skill in this package — 31 in total — with a one- or two-line summary each.

Each skill lives at `kit/skills/backend/<name>/`, one level under the domain directory, and that folder name is both the skill's `name:` and the folder name it is installed under. **Skill** below is therefore all you need: it is what you invoke as `/name`, what appears under `.claude/skills/` once installed, and where the source sits. The three-character prefix is the domain — see [the flatten build convention](https://github.com/openreachtech/hora-skills-ort-renchan/blob/main/.claude/skills/flatten/SKILL.md) for the layout and the naming rules. Full guidance for any skill is in its own `SKILL.md`.

| Skill (= Command) | Summary |
| :-- | :-- |
| `hor-agent-loop` | Build an LLM agent loop with the three `@openreachtech/mentsu-agent-loop` packages — the core iteration engine, a BullMQ job runner, and a GraphQL mutation plus progress subscription. |
| `hor-ai-agent-structure` | Structure an app-side AI agent on `mentsu-agent-loop-core`: a `ProceduralAgentLoop` subclass plus per-step `BaseAgentAction` subclasses under `app/agents/<name>/`. |
| `hor-ai-prompt-document-store` | Hold agent config, instructions, documents and tool schemas in the database rather than in code, assembling the runtime prompt at request time and versioning through backup tables. |
| `hor-backend-testing` | Where a test file goes (`tests/__tests__` vs `tests/_orders`), how run order among DB-writing tests is guaranteed, how to run the suite, and the purity rules for tests and doubles. |
| `hor-bank-id` | Allocate an exclusive, collision-free row-id prefix for a requester inside one backend repository, so two writers never pick the same explicit id in seeders and test fixtures. |
| `hor-build-e2e-test-environment` | Build, run and debug the hand-operated local E2E stack under `e2e/docker/` — its containers, the reverse-proxy edge where production has one, its seed set, and the `up`/`start`/`seed`/`clean`/`down` scripts. |
| `hor-constant-definition` | Define an application constant as two files: a CommonJS master under `constants/` (the source of truth) plus an ESM bridge under `app/constants/` that re-exports it. |
| `hor-cookie-authentication` | Cookie-based authentication for a renchan backend, per actor — the credential and token models, access plus rotating refresh tokens with reuse detection, the HttpOnly refresh cookie, and the signIn / signUp / signOut / renewAccessToken resolvers. |
| `hor-database-design` | The logical schema decisions made before writing a migration or model — normalization, status/category representation, column types, time storage, read scaling, versioning, history. |
| `hor-execution-placement-pattern` | Decide where processing belongs: a synchronous GraphQL/REST operation, or a background worker triggered from a handler, from a post-worker, or on a schedule. |
| `hor-external-api-client` | Implement an external HTTP/REST API client with `@openreachtech/mentsu-rocket-client` — the Launcher / Payload / Capsule trio under `app/<serviceName>Client/`. |
| `hor-graphql-schema` | Author GraphQL SDL files for a renchan server — per-audience schemas, numbered per-domain files, custom scalars, and naming, nullability, enum and pagination conventions. |
| `hor-graphql-server-engine` | Implement a per-endpoint `*GraphqlServerEngine`: its URL, schema path, resolver directories, Share/Context DI, auth filter, middleware, scalars and error codes. |
| `hor-light-rag` | Add lightweight RAG for agent documents without a vector database — a vector-first / LLM-fallback ranker over stored `Document` rows, plus a MySQL n-gram fulltext keyword index. |
| `hor-multi-llm-provider` | Support Claude / OpenAI / Gemini behind one abstraction — an abstract model processor, a base per vendor, a concrete class per model, and a loader that picks one by model name. |
| `hor-mutation-resolver` | Implement GraphQL Mutation resolvers extending `BaseMutationResolver` — state-changing operations and the single transaction each runs in. |
| `hor-post-worker` | Implement a post-worker: a hook firing after a resolver has resolved and the response has been sent, for side effects outside the API's main processing. |
| `hor-query-resolver` | Write GraphQL Query resolvers extending `BaseQueryResolver` — pagination, association includes, domain-error throwing, and the actual-vs-stub pair. |
| `hor-renchan-job-bullmq` | Write and wire background jobs with `@openreachtech/renchan-job-bullmq` — the Manifest / Worker / Dispatcher triple, repeatable jobs, enqueuing, progress publishing, concurrency and retries. |
| `hor-resolver-share` | Implement the Share class — the per-process container of shared singletons handed to every resolver as `context.share` — and decide what belongs in Share versus Context. |
| `hor-resolver-validator` | Implement `*InputValidator` classes for resolvers, extending `BaseInputValidator` and delegating value checks to `mentsu-value-inspector`. |
| `hor-restfulapi-architecture` | The REST layer of a renchan backend — the renderer architecture under `server/restfulapi/`, routes and versions, `render()`, response/error hashes, the auth filter, and flushers. |
| `hor-security-audit` | Read-only, repo-wide security audit of a Node project, producing a findings list — injection, auth gaps, exposure, secrets, dependencies, CORS, rate limiting, PII, uploads. |
| `hor-sequelize-migration` | Write renchan/Sequelize migrations — `createTable`, `addColumn`/`removeColumn`, `addIndex`, index naming, and whether to add a foreign-key column. |
| `hor-sequelize-model` | Write renchan/Sequelize model definitions — attributes, `createOptions`, associations, scopes, hooks, and how to wire a `MixinModel`. |
| `hor-sequelize-seeder` | Write renchan/Sequelize seeders — the master / dev-master / development split, the file skeleton, filename numbering, and per-file seed-id blocks. |
| `hor-sequelize-subquery` | Define named subqueries with `this.addSubquery` and consume them via `Model.subquery(name, params)`; filtering by a related table is a subquery, not a JOIN. |
| `hor-strategy-pattern` | Replace an else-if/switch dispatch chain with a base processor, one subclass per variant, and a bulk loader that auto-discovers subclasses and picks one by a dispatch getter. |
| `hor-stub-api` | Implement a stub resolver returning hardcoded, schema-accurate data with no DB access, so the frontend can develop against the API contract before the real backend exists. |
| `hor-subscription-resolver` | Implement a GraphQL subscription resolver — declare the operation, scope its channel per subscriber, gate who may subscribe, and wire the publish side. |
| `hor-type-interface` | Define `.d.ts` type interfaces — model interfaces under `types/models/` (global `model`) and resolver Input/Result types under `types/resolvers/<category>/`. |

