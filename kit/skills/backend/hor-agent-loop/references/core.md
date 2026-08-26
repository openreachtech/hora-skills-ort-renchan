# Core (`@openreachtech/mentsu-agent-loop-core` spec and use cases)

Rules for the iteration engine itself. Referenced from `SKILL.md`. Core has **zero dependencies
(deps:0)** and imports nothing about AI, DB, queues, or GraphQL. Business dependencies are all received
through **`context` (a DI seam)** (the grand principle in `SKILL.md`). Job execution and GraphQL
integration are [renchan-job-integration.md](./renchan-job-integration.md) /
[graphql-integration.md](./graphql-integration.md); testing is [testing.md](./testing.md).

All imports come from `@openreachtech/mentsu-agent-loop-core`.

## Exported classes

| Category | Class | Role |
| --- | --- | --- |
| Action | `BaseAgentAction` | Base for an app "capability". Implement `get name` / `get description` / `run` |
| Action | `AgentActionRegistry` | Bundles actions by `name → action` (`getAction` / `describeActions`) |
| Loop | `BaseAgentLoop` | Skeleton of the iteration engine (tail-recursive `iterate`, QC hooks, automatic progress) |
| Loop | `AiDrivenAgentLoop` | **The AI decides the next move.** Implement `registry` / `decideNext` / `reduceActionResult` |
| Loop | `ProceduralAgentLoop` | **Code decides the procedure.** Implement `advanceState` (the procedure body) |
| Composition | `BaseCompositeAgent` | Parallel fan-out / fan-in (`planSubTasks` / `createSubAgent` / `mergeResults`, `concurrency`) |
| Composition | `BaseAgentPipeline` | Sequential composition (`get stageCtors`). Threads the payload via immutable merge |
| Composition | `BaseActionStage` | Wraps a single action as a Runnable (`ActionCtor` / `buildArgumentHash` / `buildOutput`) |
| Runner | `BaseAgentRunner` / `InlineAgentRunner` | Execution-mode abstraction and in-process implementation (`request({ input, onProgress })`) |
| VO | `AgentProgressEvent` | Standard shape of a progress event (`create({ phase, iteration, payload }).toHash()`) |
| VO | `AgentTopic` | Structurally matches the publish/subscribe channel name (`create({ channel, scope }).value`) |
| Error | `AgentLoopError` / `ConcreteMemberNotFoundError` / `ActionNotFoundError` | Error base and concretes |
| Testing | `LoopContractAssertion` / `ActionContractAssertion` in `.../lib/testing/index.js` | Contract test kit ([testing.md](./testing.md)) |

## The Runnable contract (why composition works)

`BaseAgentLoop` / `BaseCompositeAgent` / `BaseAgentPipeline` / `BaseActionStage` / Runner all satisfy
the same contract. **Because of this one contract, loops, composites, and stages can be nested inside
one another.**

```
static create({ context })   +   async run({ input, onProgress })
```

- **Why unify it**: you can freely put a loop as a pipeline stage, or another pipeline inside a
  composite, because every Runnable has the same `create` / `run`. When you add a new Runnable,
  always give it this shape.

## The state model (do not mix the three concepts)

| Concept | Holds | Lifetime |
| --- | --- | --- |
| **state (iteration state)** | Per-step output, history, score | One run; **updated immutably** per iteration (`{ ...state, ... }`) |
| **context (shared dependencies)** | DI for AI / DB / external clients | Read-only and constant across the whole run |
| **compression (working context)** | The cumulative context passed to the AI | Grows per iteration → shrunk by `compressContext` |

- **Why separate them**: making state mutable, or mixing iteration state into context, breaks resume,
  parallelism, and testing. **Keep state immutable-updated and context read-only.**

## Action: `BaseAgentAction`

Define a "capability" as one class per file. Business dependencies are **always reached through
`argumentHash` and `context`**.

Members to override:

- `get name` (required): the registry key / the identifier the AI selects by.
- `get description` (required): the description used for selection (`describeActions()` formats it into
  a prompt).
- `async run({ argumentHash, context, onProgress })` (required): the capability body. Side effects
  through `context` only.
- `isValidArgumentHash({ argumentHash })` (optional): pre-run argument validation (default `true`).

```js
import {
  BaseAgentAction,
} from '@openreachtech/mentsu-agent-loop-core'

/**
 * An action that searches for a topic.
 *
 * @extends {BaseAgentAction}
 */
export default class SearchAction extends BaseAgentAction {
  /** @override */
  get name () {
    return 'search'
  }

  /** @override */
  get description () {
    return 'Search by keyword. Arguments: { keyword: string }'
  }

  /** @override */
  async run ({
    argumentHash,
    context,
    onProgress = null,
  }) {
    // Progress can be emitted from inside an action too (onProgress is optional).
    onProgress?.({
      phase: 'searching',
      keyword: argumentHash.keyword,
    })

    // Business dependencies come from context (no direct import).
    return context.searchClient.search({
      keyword: argumentHash.keyword,
    })
  }
}
```

```js
// Avoid: importing a dependency directly inside an action
//   → it can't be swapped for a stub in in-process tests, breaking the one-way dependency. Use context.
import searchClient from '../../clients/searchClient.js' // ← NG
```

Bundle actions with `AgentActionRegistry.create({ actions: [...] })`. Resolve with `getAction({ name })`
(throws `ActionNotFoundError` if unregistered); `describeActions()` yields a `- name: description` list.

## Choosing a loop type (two types)

A loop always implements the four abstract hooks of `BaseAgentLoop`: `createInitialState({ input })` /
`advanceState({ state, iteration })` / `isComplete({ state, iteration })` / `buildResult({ state })`.
Tune the QC hooks via getters: `get maxIterations` (default 10, the safety bound) / `get
compressionInterval` (default null). `iterate` **always stops on `isComplete` or `maxIterations`** and
emits `onProgress` every iteration (not overridable).

| Aspect | `AiDrivenAgentLoop` (AI-driven) | `ProceduralAgentLoop` (procedural) |
| --- | --- | --- |
| Who decides the next move | **The AI** (`decideNext` asks each time) | **Code** (the fixed procedure in `advanceState`) |
| Control flow | Non-deterministic, exploratory | Deterministic, reproducible |
| What the app writes | `registry` / `decideNext` / `reduceActionResult` | `advanceState` (calls capabilities via `performAction`) |
| Fits | Exploratory tasks with no readable procedure | Tasks with a fixed procedure |

- **Why `maxIterations` is always enforced**: whether AI-driven or procedural, a bug in the stop
  condition or an unstable external response can loop forever. `maxIterations` (default 10) is the
  safety bound; even if `isComplete` never returns true, the loop still stops.
- ⚠️ Procedural does not mean "no AI". You may use the AI as a **tool inside a step**. The difference is
  **whether the AI holds the control flow**.

### AI-driven: `AiDrivenAgentLoop`

The base implements `advanceState` as "`decideNext` → `registry.getAction` → `action.run` →
`reduceActionResult`". The app writes the following.

```js
import {
  AiDrivenAgentLoop,
  AgentActionRegistry,
} from '@openreachtech/mentsu-agent-loop-core'

import SearchAction from './actions/SearchAction.js'
import RefineAction from './actions/RefineAction.js'

/**
 * @extends {AiDrivenAgentLoop}
 */
export default class ResearchAgentLoop extends AiDrivenAgentLoop {
  /** @override */
  get maxIterations () {
    return 6
  }

  /** @override */
  get registry () {
    return AgentActionRegistry.create({
      actions: [
        SearchAction.create(),
        RefineAction.create(),
      ],
    })
  }

  /** @override */
  createInitialState ({
    input,
  }) {
    return {
      keyword: input.keyword,
      history: [],
      score: 0,
    }
  }

  /** @override */
  async decideNext ({
    state,
  }) {
    // Let the AI decide the next action (AI client via context).
    return this.context.aiAgent.decideNextAction({
      history: state.history,
      describedActions: this.registry.describeActions(),
    })
  }

  /** @override */
  async reduceActionResult ({
    state,
    action,
    result,
  }) {
    return {
      ...state,
      history: [
        ...state.history,
        {
          action: action.name,
          result,
        },
      ],
      score: result.score ?? state.score,
    }
  }

  /** @override */
  isComplete ({
    state,
  }) {
    return state.score >= 0.8
  }

  /** @override */
  buildResult ({
    state,
  }) {
    return {
      items: state.history.at(-1)?.result?.items ?? [],
      iterations: state.history.length,
    }
  }
}
```

### Procedural: `ProceduralAgentLoop`

Write the procedure in `advanceState`, and call a capability with `performAction({ name, argumentHash,
context })`.

```js
/** @override */
async advanceState ({
  state,
}) {
  const found = await this.performAction({
    name: 'search',
    argumentHash: {
      keyword: state.keyword,
    },
    context: this.context,
  })

  const refined = await this.performAction({
    name: 'refine',
    argumentHash: {
      previousResults: found.items,
    },
    context: this.context,
  })

  return {
    ...state,
    keyword: refined.keyword,
    items: found.items,
    score: found.score,
  }
}
```

## Composition (bundling multiple Runnables)

### Sequential: `BaseAgentPipeline`

Chain stages of different natures (each stage is a Runnable) in series. The app declares only
`get stageCtors` (`[{ name, Ctor }]`); the base handles payload hand-off, progress tagging, and
sequential execution.

- Override `createInitialPayload({ input })` (default: the input as-is), `mapStageOutput({ stage, input,
  output })` (default: the immutable merge `{ ...input, ...output }`), and `buildResult({ payload })`
  (default: the payload as-is) only when needed.
- The base attaches `stage: <name>` to progress events (`buildStageEvent`).

```js
import {
  BaseAgentPipeline,
} from '@openreachtech/mentsu-agent-loop-core'

import KeywordStage from './KeywordStage.js'
import SearchStage from './SearchStage.js'
import RerankStage from './RerankStage.js'

/**
 * @extends {BaseAgentPipeline}
 */
export default class ResearchPipeline extends BaseAgentPipeline {
  /** @override */
  get stageCtors () {
    return [
      {
        name: 'keyword',
        Ctor: KeywordStage,
      },
      {
        name: 'search',
        Ctor: SearchStage,
      },
      {
        name: 'rerank',
        Ctor: RerankStage,
      },
    ]
  }

  /** @override */
  buildResult ({
    payload,
  }) {
    return {
      ranked: payload.ranked,
    }
  }
}
```

- **Do not override `run()`.** Sequential execution, payload merging, and progress tagging are the
  base's assets. Why: reimplementing `run` forces you to re-guarantee progress tagging and immutable
  merging yourself, and its behavior drifts from other pipelines. If you need resume/idempotency,
  handle it in the stages / `context` (see idempotency in
  [renchan-job-integration.md](./renchan-job-integration.md)).

### A single action as a stage: `BaseActionStage`

A thin base that turns one `BaseAgentAction` into a pipeline stage (a Runnable). Declare just three
members.

```js
import {
  BaseActionStage,
} from '@openreachtech/mentsu-agent-loop-core'

import RerankAction from './actions/RerankAction.js'

/**
 * @extends {BaseActionStage}
 */
export default class RerankStage extends BaseActionStage {
  /** @override */
  static get ActionCtor () {
    return RerankAction
  }

  /** @override */
  buildArgumentHash ({
    input,
  }) {
    return {
      hits: input.hits, // ← the previous stage's output becomes the argument
    }
  }

  /** @override */
  buildOutput ({
    result,
  }) {
    return {
      ranked: result.items,
    }
  }
}
```

### Parallel: `BaseCompositeAgent`

Split the input into sub-tasks, run sub-agents (Runnables) in **parallel bounded by `concurrency`**,
and combine with `mergeResults`. Implement `planSubTasks` / `createSubAgent` / `mergeResults`, and cap
the degree of parallelism with `get concurrency` (default `Infinity`).

```js
/** @override */
get concurrency () {
  return 3
}

/** @override */
planSubTasks ({
  input,
}) {
  return input.keywords
    .map(keyword => ({
      keyword,
    }))
}

/** @override */
createSubAgent ({
  subTask,
}) {
  return ResearchAgentLoop.create({
    context: this.context,
  })
}

/** @override */
mergeResults ({
  results,
}) {
  return {
    items: results.flatMap(one => one.items),
  }
}
```

- **Why cap `concurrency`**: if sub-agents hit an AI / external API, unbounded parallelism causes rate
  overruns and memory exhaustion. Do not leave it at the default `Infinity`; set a finite value
  whenever external I/O is involved.

## Runner (execution-mode abstraction)

Make the caller depend only on `runner.request({ input, onProgress })`, so the concrete (in-process vs
Redis job) can be swapped. The contract is `BaseAgentRunner#request`.

- `InlineAgentRunner.create({ AgentLoopCtor, context })` — in-process execution. `request` returns the
  loop's **final result**. For CLI / tests / synchronous work / Lambda.
- The Redis version `JobAgentRunner` is provided by the renchan-job adapter
  ([renchan-job-integration.md](./renchan-job-integration.md)). Its `request` returns `{ accepted, jobId }`
  and progress goes over a Subscription.

```js
import {
  InlineAgentRunner,
} from '@openreachtech/mentsu-agent-loop-core'

const runner = InlineAgentRunner.create({
  AgentLoopCtor: ResearchAgentLoop,
  context: {
    aiAgent,
    searchClient,
  },
})

const result = await runner.request({
  input: {
    keyword: 'example',
  },
  onProgress: event => console.log(event),
})
```

- **Why put a Runner in front**: the same loop can be in-process in development and a Redis job in
  production, switched by `env`, with no change to the caller. Keep the caller from touching a concrete
  Loop or Dispatcher directly.

## Progress VO and Topic

- `AgentProgressEvent.create({ phase, iteration, payload }).toHash()` — the standard progress shape
  `{ phase, iteration, payload }`. `iteration` / `payload` default to `null`. A VO that produces a shape
  that rides directly on `job.updateProgress` or JSON. The loop's default per-iteration event is
  `{ phase: 'iteration', iteration }`.
- `AgentTopic.create({ channel, scope }).value` — composes the publish/subscribe channel name. If
  `scope` is `null`, the value is `channel` itself; otherwise `channel:key=value&...` (**keys sorted
  ascending** before joining).

```js
import {
  AgentTopic,
} from '@openreachtech/mentsu-agent-loop-core'

AgentTopic
  .create({
    channel: 'researchProgress',
    scope: {
      userId: 1001,
    },
  })
  .value // → 'researchProgress:userId=1001'
```

- **Why sort the scope keys**: even if the publish and subscribe sides build the scope object with a
  different key order, sorting produces the same string. This is the key to "the publish and subscribe
  channels match" ([graphql-integration.md](./graphql-integration.md) /
  [renchan-job-integration.md](./renchan-job-integration.md)).
- To change the naming rule, extend `AgentTopic`, override `get value()`, and use the **same** extended
  class on both the publish and subscribe sides. Swapping only one side makes the channels drift.

## Unimplemented abstracts throw `ConcreteMemberNotFoundError`

Touching an abstract member (`get name` / `createInitialState`, etc.) without implementing it throws
`ConcreteMemberNotFoundError`. Use this in tests to "detect the unimplemented" ([testing.md](./testing.md)).
