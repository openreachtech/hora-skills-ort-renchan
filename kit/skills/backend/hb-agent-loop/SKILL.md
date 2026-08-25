---
name: hb-agent-loop
description: >
  Build an LLM agent loop (iterative agent) in a backend repository with the three
  @openreachtech/mentsu-agent-loop packages — core (the transport-agnostic iteration engine),
  renchan-job (run a loop as a BullMQ/Redis job with progress publishing), and graphql (a mutation
  that launches the loop plus a subscription that streams its progress). Use whenever the user
  asks to add or edit an agent loop, an agent action, a composite agent, or to stream agent
  progress.
---

# Agent Loop (building agent loops with mentsu-agent-loop)

A skill for implementing an LLM agent's iteration ("loop") in a backend. The iteration engine,
progress delivery, composition, job execution, and GraphQL integration are all provided by the
**three `@openreachtech/mentsu-agent-loop-*` packages**. The app writes only the domain-specific
**actions and loops**; iteration, stopping, compression, parallelism, and transport ride on the
ready-made base classes.

This skill covers the libraries' specs and use cases, plus the integration patterns for renchan's
GraphQL and renchan-job-bullmq. **Always use these three packages** (never hand-roll your own
iteration engine, queue bridge, or progress channel). The details are split into the [detail
files](#detail-files) at the end.

## Grand principle: write actions and loops without knowing about AI, DB, queues, or GraphQL (one-way dependency)

The center of this package family's design is a **one-way dependency direction (outer → core)**.
The iteration logic the app writes (actions / loops) **imports no business dependency and no
transport**; everything is reached through the **`context` (an opaque DI seam)** and through **thin
adapters**.

| Layer | Package | Responsibility | Depends on |
| --- | --- | --- | --- |
| **core** | `@openreachtech/mentsu-agent-loop-core` | Iteration engine (Action / Loop / composition / Runner / Topic). **Zero dependencies** | imports nothing |
| **job execution** | `@openreachtech/mentsu-agent-loop-renchan-job` | Run a loop as a renchan-job / BullMQ Redis job and publish progress | → core, renchan-job-bullmq |
| **GraphQL** | `@openreachtech/mentsu-agent-loop-graphql` | Launch mutation + progress-subscription | → core, renchan |
| **app** | (this repository) | Actions / loops / wiring | → all of the above |

- **Why keep the dependency one-way**: the moment core imports AI/DB/queue/transport, the iteration
  logic is bound to a specific backend and can no longer be tested in-process or switched between
  execution modes. Keeping core dependency-free and receiving dependencies from `context` means **the
  same loop runs in-process or as a job, and tests just swap `context` for a stub**.
- **Why write only actions and loops**: the iteration body (the tail-recursive `iterate`), the
  progress seam (`emitProgress`), composition (parallel / sequential), the queue bridge, and channel
  naming are all **shared machinery**; writing them per app guarantees drift. Push them into the base
  classes and implement only the abstract hooks.
- **Why "always these three packages"**: hand-rolling an iteration engine or progress channel
  reintroduces known failures — publish/subscribe channel mismatch, no retry, untestable code. The
  packages prevent these by design (e.g. `AgentTopic` structurally matches the publish and subscribe
  channels).
- **Everything is an instance method, overridable via `extends`**. No pure functions or static-only
  classes. Why: even if the library has a bug or a gap, the app can always work around it by extending
  and overriding the relevant method (there is no true `final`). Write the app's overrides in the same
  style.

## Cross-cutting rules

- **Business dependencies and transport are always received through `context`.** Do not directly
  import AI clients, DB, HTTP, or queues inside an action or loop ([core.md](./references/core.md)).
  Why: a direct import breaks in-process execution and stub injection, collapsing the one-way
  dependency of the grand principle.
- **Return `null` / an empty array for missing values, not `undefined`.** **One property per line in
  object literals** (applies to sample code too). **Avoid single-character variables and
  `for` / `forEach` / `switch` / `else if`**; write with `map` / `filter` / `reduce` and early return.
  Why: match the existing codebase style so review attention goes to the logic.
- **One class per file, one `export default`.** The constructor only assigns; defaults live in the
  factory (`static create`); getters just return the field.
- **Comments in produced artifacts (`.js`) are English**, and this skill is written entirely in
  English (prose, tables, and example-code comments).

## Choosing modules (what to install)

Stack adapters onto core per the requirement. **Core is always required**; add an adapter only when
that integration is needed.

| What you want | Packages needed |
| --- | --- |
| Run a loop in-process (CLI / tests / synchronous work / Lambda) | core only |
| Turn a long loop into a Redis job (horizontal scale, retry, rate limiting) | core + renchan-job |
| Launch over GraphQL and subscribe to progress in realtime | core + renchan-job + graphql |

- **Why stack incrementally**: actions and loops written with core alone can be turned into a job or a
  GraphQL endpoint **without any change** (the adapter swaps only the transport step). Do not install
  everything up front; layer on only what you need.

## End-to-end progress (the backbone of the realtime log)

"Launch with a mutation → return `accepted` immediately → stream progress over a subscription" is the
typical shape for an agent on the web. Progress follows this single path. Because the publish side
(the Worker) and the subscribe side (the Subscription) use the **same `AgentTopic`**, the channel
names match structurally.

```
[core]        loop.run({ input, onProgress })
                └ iterate emits emitProgress → onProgress(event) each iteration
[renchan-job] BaseAgentJobWorker: onProgress → job.updateProgress(event)
                → onJobProgress → publish to the channel AgentTopic.create({ channel, scope }).value
[graphql]     BaseAgentProgressSubscriptionResolver: subscribes to the same channel + scope
[frontend]    receives it in realtime over a GraphQL Subscription
```

- **Why use `AgentTopic` on both sides**: if the publish and subscribe channel names drift apart, you
  get a silent "progress never arrives" failure. Concentrating the naming in one core class, with both
  sides composing from the same `channel` + `scope`, makes drift impossible by design. To change the
  naming rule, extend `AgentTopic` and override `get value()` in one place.

## Detail files

- [core.md](./references/core.md) — the core (`@openreachtech/mentsu-agent-loop-core`) spec and use
  cases: actions / registry, the two loop types (AI-driven / procedural), composition (parallel
  Composite / sequential Pipeline / ActionStage), Runners, `AgentTopic` / `AgentProgressEvent`, the
  state model (state / context / compression).
- [graphql-integration.md](./references/graphql-integration.md) — the pattern for integrating with
  renchan's GraphQL: the launch mutation (`BaseRequestAgentMutationResolver`) and the progress
  subscription (`BaseAgentProgressSubscriptionResolver`), channel matching via `AgentTopic`.
- [renchan-job-integration.md](./references/renchan-job-integration.md) — the pattern for integrating
  with renchan-job-bullmq: the Worker (`BaseAgentJobWorker`) / Dispatcher (`BaseAgentJobDispatcher`) /
  `JobAgentRunner`, Engine / Share / Context wiring, `concurrency` / `limiter`, and the full
  progress-publish flow.
- [testing.md](./references/testing.md) — testing guidelines: the contract test kit
  (`LoopContractAssertion` / `ActionContractAssertion`) and the unit-test approach for actions / loops
  / composition / Worker / Dispatcher / Resolver (stub `context`, assert `onProgress`, assert abstract
  throws).
