# renchan-job Integration (`@openreachtech/mentsu-agent-loop-renchan-job`)

Rules for the adapter that runs a core loop (any Runnable) **as a Redis job** inside a renchan-job-bullmq
Worker and publishes progress. Referenced from `SKILL.md`. The core side is [core.md](./core.md), GraphQL
launch/subscribe is [graphql-integration.md](./graphql-integration.md), and testing is
[testing.md](./testing.md).

The point of this adapter is to move in-process execution onto Redis job execution **without changing any
action or loop code**. Queues, the worker pool, Redis, retry, shutdown, and logging are all delegated to
renchan-job-bullmq; the adapter bridges only **executeJob → `loop.run` / onProgress →
`job.updateProgress` / lifecycle → publish**.

## Classes and the overall wiring

| Class | Extends | What the app overrides |
| --- | --- | --- |
| `BaseAgentJobWorker` | renchan-job `BaseJobWorker` | `static get AgentLoopCtor` / `get channel` / `createAgentContext` |
| `BaseAgentJobDispatcher` | renchan-job `BaseJobDispatcher` | `static get EngineCtor` / `static get ManifestCtor` |
| `JobAgentRunner` | core `BaseAgentRunner` | (none; use it via `create({ DispatcherCtor })`) |

Combine these with the renchan-job-bullmq **Engine / Share / Context / Manifest** (provided by the app).
If an existing renchan-job setup is present, you can **ride along** on it (just do not reuse a `jobName`
of an existing job).

## Worker: `BaseAgentJobWorker`

The core that runs the loop inside the job. **The app implements only three abstract members**; the
`executeJob` body, progress bundling, publish, and parallelism control are already implemented by the
adapter base.

| Member | Kind | Description |
| --- | --- | --- |
| `static get AgentLoopCtor()` | abstract | The Ctor of the Runnable (Loop / Pipeline / Composite) to run |
| `get channel()` | abstract | The progress publish channel name (**same as the Subscription resolver's**) |
| `createAgentContext({ context, parcel })` | abstract | Build the agent-loop context (DI seam) from the renchan-job context |
| `buildScope({ jobModel })` | hook | The scope that namespaces the channel (default `null`) |
| `static get AgentTopicCtor()` | hook | Default `AgentTopic`. Override to change the naming rule |
| `get subscriptionBroker()` | hook | Default `this.engine.subscriptionBroker` |
| `publishProgress({ topic, event })` | hook | Default `this.subscriptionBroker.publish(topic, event)` |
| `buildOptionHash()` | implemented | Forwards `concurrency` / `limiter` to the BullMQ Worker (the base only passes `connection`) |
| `executeJob` / `onJobProgress` / `onJobCompleted` / `onJobFailed` / `onWorkerError` | implemented | Execution and publish |

What `executeJob({ body, context, parcel })` does (implemented by the base):

```
createAgentContext({ context, parcel })                     ← assemble the DI seam
AgentLoopCtor.create({ context: agentContext })
  .run({ input: body, onProgress: buildProgressSink({ parcel }) })
        └ buildProgressSink = event => parcel.jobModel.job.updateProgress(event)
```

After that, BullMQ's progress/completed/failed events call `onJobProgress` / `onJobCompleted` /
`onJobFailed`, each publishing to the channel `buildTopic({ scope: buildScope({ jobModel }) })`
(completed publishes `{ phase: 'done', payload: result }`, failed publishes
`{ phase: 'error', payload: { message } }`).

```js
import {
  BaseAgentJobWorker,
} from '@openreachtech/mentsu-agent-loop-renchan-job'

import ResearchPipeline from '../../agentLoops/ResearchPipeline.js'
import ResearchJobManifest from './ResearchJobManifest.js'

/**
 * @extends {BaseAgentJobWorker}
 */
export default class ResearchJobWorker extends BaseAgentJobWorker {
  /** @override */
  static get ManifestCtor () {
    return ResearchJobManifest
  }

  /** @override */
  static get AgentLoopCtor () {
    return ResearchPipeline
  }

  /** @override */
  get channel () {
    return 'researchProgress' // ← must be the same string as the Subscription resolver
  }

  /**
   * Build the agent-loop context (DI seam) from the renchan-job context.
   *
   * @override
   */
  createAgentContext ({
    context,
  }) {
    return {
      // context exposes delegating getters, so this is a 1-hop read (Demeter).
      aiAgent: context.aiAgent,
      searchClient: context.searchClient,
    }
  }
}
```

### `createAgentContext` must do synchronous "wiring" only

`createAgentContext` is the **synchronous wiring** that maps the renchan-job context onto the agent-loop
context. **Do not do async work (DB loads, external calls) eagerly here.**

- **Why synchronous**: the base's `executeJob` calls `createAgentContext(...)` **without `await`**.
  Returning a Promise here corrupts the context. If you need async resource acquisition, put a
  **lazily-resolving getter/method** on `context` and let the **action call it through `context` at run
  time**. This avoids overriding `executeJob` and keeps the iteration logic in the "fetch from context
  when needed" shape.

```js
// Good: createAgentContext is synchronous wiring; async is passed as a context method the action awaits
/** @override */
createAgentContext ({
  context,
}) {
  return {
    resolveAiAgent: params => context.resolveAiAgent(params), // actual resolution is awaited inside the action
  }
}
```

```js
// Avoid: making createAgentContext async so it carries a DB load
//   → the base executeJob does not await it, so the context becomes a Promise and breaks. Forces an executeJob override.
async createAgentContext ({
  context,
}) { // ← NG
  const record = await context.loadRecord(...) // eager async

  return {
    record,
  }
}
```

### Keep the progress channel identical on the publish and subscribe sides

The publish side (the Worker's `channel` + `buildScope`) and the subscribe side (the Subscription's
`channel` + `generateChannelQuery`) must use the **same `channel` string and the same scope keys**.

- **Why**: `AgentTopic` guarantees the channel **format** matches, but the **`channel` string itself and
  the scope key set** are the app's responsibility to align. A mismatch here is a silent "dropped
  progress" (e.g. the Worker publishes with a `{ jobId }` scope while the Subscription subscribes to
  `{ userId }`).
- Define the `channel` string in **one place (a shared constant, etc.)** and have the Worker and the
  Subscription reference the same value. Do not duplicate the literal in several places (a source of
  drift).
- Make the key set returned by `buildScope` match the key set returned by the Subscription's
  `generateChannelQuery` ([graphql-integration.md](./graphql-integration.md)). Do not publish a scope
  that nothing subscribes to.

### Parallelism and rate limiting

`concurrency` (loops one Worker runs at once) and `limiter` (per-window ceiling) are forwarded to the
BullMQ Worker by `buildOptionHash()` (required, because the base renchan-job only passes `connection`).
The app just writes `concurrency` / `limiter` into the Worker's config seam.

```js
/** @override */
static get additionalConfig () {
  return {
    concurrency: 3, // ← number of Agent Loops one Worker runs at once
    limiter: { // ← rate limit (guards an external AI API ceiling; optional)
      max: 10,
      duration: 1000,
    },
  }
}
```

- **Why set it**: if the loop hits an AI / external API, unbounded parallelism causes rate overruns and
  memory exhaustion. For loops with external I/O, keep `concurrency` finite and add a `limiter` when
  needed. Scale horizontally (number of Worker processes) on the operations side.

## Dispatcher: `BaseAgentJobDispatcher`

The enqueue side. A thin wrapper over renchan-job's dispatcher; the app just points to `EngineCtor` /
`ManifestCtor`. It provides the `dispatchAgentJob({ input, optionHash })` alias that enqueues the loop
input as the job body (`dispatchJob` / `createAsync` / `teardown` are inherited from the renchan-job
base as-is).

```js
import {
  BaseAgentJobDispatcher,
} from '@openreachtech/mentsu-agent-loop-renchan-job'

import ResearchJobEngine from './ResearchJobEngine.js'
import ResearchJobManifest from './ResearchJobManifest.js'

/**
 * @extends {BaseAgentJobDispatcher}
 */
export default class ResearchJobDispatcher extends BaseAgentJobDispatcher {
  /** @override */
  static get EngineCtor () {
    return ResearchJobEngine
  }

  /** @override */
  static get ManifestCtor () {
    return ResearchJobManifest
  }

  /** @override */
  static get optionHash () {
    return {
      defaultJobOptions: {
        attempts: 2, // ← job-axis retry (distinct from the loop's maxIterations)
        backoff: {
          type: 'exponential',
          delay: 30000,
        },
      },
    }
  }
}
```

- To share `EngineCtor` across several jobs, make one **app-wide Dispatcher base** that returns only
  `EngineCtor`, and have each job Dispatcher return only `ManifestCtor` (avoids duplicated wiring).

## Manifest (input schema = loop input)

Extend renchan-job-bullmq's `BaseJobManifest` and return `jobName` (the queue name) and `bodySchema`
(= the loop input). Keep the body **minimal (ids, tokens)**.

```js
import {
  BaseJobManifest,
} from '@openreachtech/renchan-job-bullmq'

import {
  ScalarHash,
} from '@openreachtech/mentsu-schema'

const {
  Integer,
} = ScalarHash

/**
 * @extends {BaseJobManifest}
 */
export default class ResearchJobManifest extends BaseJobManifest {
  /** @override */
  static get jobName () {
    return 'research'
  }

  /** @override */
  static get bodySchema () {
    return {
      jobId: Integer,
    }
  }
}
```

## Engine / Share / Context (renchan-job-bullmq; one set per app)

The Redis connection, worker discovery, and shared DI live in the renchan-job-bullmq Engine / Share /
Context. Reuse existing ones if present; otherwise provide them. **The progress-publish broker is held
by the Share and exposed by the Engine via a delegating getter.**

- **Engine** (`extends BaseJobEngine`): `config` (`workersPath` / `redisConfig`, etc.), `ShareCtor` /
  `ContextCtor`, `createAsync({ subscriptionBroker })`, and the delegating `get subscriptionBroker()`.
- **Share** (`extends BaseJobShare`; shared across the process): holds `subscriptionBroker` and shared
  clients (AI, DB, etc.).
- **Context** (`extends BaseJobContext`; per job): exposes the dependencies `createAgentContext` reads
  via **delegating getters** (`get aiAgent()` → `this.share.aiAgent`, etc.; a 1-hop Demeter read).

```js
// Engine (excerpt): inject subscriptionBroker and expose it via a delegating getter for 1-hop access from the Worker.
/** @override */
static async createAsync ({
  config = this.config,
  subscriptionBroker,
} = {}) {
  const share = await this.ShareCtor.createAsync({
    subscriptionBroker,
  })

  return this.create({
    config,
    share,
  })
}

/** @override */
get subscriptionBroker () {
  return this.share.subscriptionBroker
}
```

### If you use renchan's SubscriptionBroker, match `publishProgress` to it

The adapter base's `publishProgress` defaults to calling **`this.subscriptionBroker.publish(topic,
event)` (positional args)**. If the broker you use has a different signature (e.g. renchan's
`SubscriptionBroker` takes `publish({ channel, message })`), override `publishProgress` to match the
shape.

```js
// Good: adapt publishProgress to renchan SubscriptionBroker's signature
/** @override */
publishProgress ({
  topic,
  event,
}) {
  return this.subscriptionBroker.publish({
    channel: topic,
    message: event,
  })
}
```

- **Why absorb it here**: the broker's call shape is a transport difference and must not leak into
  actions/loops. Absorbing it in the Worker's `publishProgress` (and, if needed, `get
  subscriptionBroker()`) in one place lets the rest of the progress path (`buildTopic` / `onJobProgress`)
  stay untouched.

## Startup and enqueue

- **Daemon**: build the `SubscriptionBroker`, inject it via `Engine.createAsync({ subscriptionBroker })`,
  and start the Workers under `workersPath` with renchan-job's `JobWorkersDaemon`. In enqueue-only
  processes (which do not publish progress), pass no broker and publish becomes a no-op.
- **Enqueue (request-based)**: enqueue from a GraphQL/REST handler via the Dispatcher. The standard for
  GraphQL launch is `BaseRequestAgentMutationResolver` in
  [graphql-integration.md](./graphql-integration.md). To enqueue directly inside a handler, use
  `dispatcher.dispatchJob({ body })` (or `dispatchAgentJob({ input })`).

## Idempotency (assume BullMQ retries)

Setting `optionHash.attempts` means the job may re-run. **Make `executeJob` idempotent.**

- **Why**: so a retry re-running from the middle does not cause double writes or duplicated side effects.
- To carry intermediate results across retries, **do not reimplement `run()` or `executeJob`**; handle
  it via the loop's state and persistence hooks through `context` (saving/reading a checkpoint), so the
  base's iteration and payload merge stay intact (see `BaseAgentPipeline` in [core.md](./core.md)).

## Switching execution mode (in-process ⇔ Redis)

Make the caller depend only on `BaseAgentRunner#request` and swap the concrete by `env`, etc. Actions
and loops do not change at all.

```js
import {
  InlineAgentRunner,
} from '@openreachtech/mentsu-agent-loop-core'

import {
  JobAgentRunner,
} from '@openreachtech/mentsu-agent-loop-renchan-job'

const runner = env.USE_REDIS
  ? JobAgentRunner.create({ // Redis (async; returns { accepted, jobId })
    DispatcherCtor: ResearchJobDispatcher,
  })
  : InlineAgentRunner.create({ // in-process (sync; returns the final result)
    AgentLoopCtor: ResearchPipeline,
    context: agentContext,
  })
```

| Mode | `request` returns | Progress | Use |
| --- | --- | --- | --- |
| `InlineAgentRunner` (core) | The loop's final result | in-process (`onProgress` immediately) | dev / test / CLI / synchronous work |
| `JobAgentRunner` (this adapter) | `{ accepted, jobId }` | over a Subscription | production / long-running / horizontal scale |
