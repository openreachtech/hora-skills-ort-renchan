# GraphQL Integration (`@openreachtech/mentsu-agent-loop-graphql`)

Rules for the resolver bases that **launch** a core loop from renchan's GraphQL (a Mutation) and
**subscribe to its progress in realtime** (a Subscription). Referenced from `SKILL.md`. The core side is
[core.md](./core.md), the job-execution and publish side is
[renchan-job-integration.md](./renchan-job-integration.md), and testing is [testing.md](./testing.md).

The typical shape for an agent on the web is "launch with a Mutation → return `accepted` immediately →
stream progress over a Subscription". This package bases those two resolvers, so the app completes the
integration with a few member declarations. Because the publish side (the Worker) and the subscribe side
(the Subscription) share the **same `AgentTopic`**, the channel names match structurally.

| Class | Extends (renchan) | Role |
| --- | --- | --- |
| `BaseRequestAgentMutationResolver` | `BaseMutationResolver` | Turns GraphQL variables into a job body, enqueues, and returns `{ accepted, jobId }` immediately |
| `BaseAgentProgressSubscriptionResolver` | `BaseSubscriptionResolver` | Subscribes to what the Worker publishes, on the same `AgentTopic` channel |

## Launch Mutation: `BaseRequestAgentMutationResolver`

Enqueue without waiting for the long loop, and respond immediately. The app implements only two members.

| Member | Kind | Description |
| --- | --- | --- |
| `buildJobBody({ variables })` | abstract | GraphQL variables → the job body (= the loop input) |
| `enqueue({ body, context })` | abstract | Enqueue the body via `context.share`; return the dispatch response (exposing `hasResponse()` / `idKey`) |
| `resolve({ variables, context })` | implemented | Calls `enqueue({ body: buildJobBody(...), context })` → returns `{ accepted, jobId }` |

```js
import {
  BaseRequestAgentMutationResolver,
} from '@openreachtech/mentsu-agent-loop-graphql'

import ResearchJobDispatcher from '../../../jobs/research/ResearchJobDispatcher.js'

/**
 * @extends {BaseRequestAgentMutationResolver}
 */
export default class RequestResearchMutationResolver extends BaseRequestAgentMutationResolver {
  /** @override */
  static get schema () {
    return 'requestResearch' // ← the corresponding GraphQL mutation name (renchan binding)
  }

  /** @override */
  buildJobBody ({
    variables,
  }) {
    return {
      jobId: variables.input.jobId,
    }
  }

  /**
   * Source the dispatch seam from context.share (the house DI convention) and enqueue.
   *
   * @override
   */
  async enqueue ({
    body,
    context,
  }) {
    return context.share.jobDispatcherProvider.dispatchJob({
      DispatcherCtor: ResearchJobDispatcher,
      body,
    })
  }
}
```

- **Why enqueue and return immediately**: the loop can be long-running. Running it synchronously inside
  the API causes an HTTP timeout, and a mid-way disconnect cannot recover. Enqueuing lets the API respond
  immediately while execution, retry, and progress ride on the Worker side.
- **Source the dispatcher from `context.share`, not a resolver field**: shared, connection-reusing
  instances (the job-dispatcher provider) live on `share` and are torn down at process exit, so read
  them through `context.share`. This keeps DI in one place and lets tests swap the provider via a fake
  share. The provider reuses its connection, so the resolver never calls `createAsync` / `teardown`.
- **Why the seam takes `context`**: the `enqueue({ body, context })` hook receives the per-request
  `context` so that the dispatcher can be sourced from `context.share`. A parameterless getter could
  not — a renchan resolver instance holds only `errorHash`, and `context` is a per-call argument to
  `resolve`. `resolve` (implemented by the base) calls `enqueue` with the built body, so the app never
  reimplements `resolve`. The house provider is keyed by `DispatcherCtor`
  (`dispatchJob({ DispatcherCtor, body })`), which the app passes inside `enqueue`.
- **Do not turn a light loop into a job**: a loop that finishes quickly and needs no progress
  subscription can be run inside a normal resolver with `InlineAgentRunner` ([core.md](./core.md)),
  returning the result synchronously, instead of using `BaseRequestAgentMutationResolver`. Why: the
  enqueue → subscribe machinery is for long-running, asynchronous work; bringing it to light work adds
  needless complexity.

## Progress Subscription: `BaseAgentProgressSubscriptionResolver`

Subscribe to the channel the Worker publishes to. The app implements only `channel` and
`generateChannelQuery`.

| Member | Kind | Description |
| --- | --- | --- |
| `get channel()` | abstract | The subscribe channel name (**same as the Worker's `channel`**) |
| `generateChannelQuery({ variables })` | abstract | Scope extraction (GraphQL-specific; e.g. `{ userId }`) |
| `static get AgentTopicCtor()` | hook | Default `AgentTopic`. Override to change the naming rule (**use the same extended class as the Worker**) |
| `generateChannel({ query })` | implemented | Overrides renchan's channel hook to return `AgentTopic.create({ channel, scope: query }).value` |
| `buildTopic({ variables })` | implemented | `generateChannel({ query: generateChannelQuery({ variables }) })` |

```js
import {
  BaseAgentProgressSubscriptionResolver,
} from '@openreachtech/mentsu-agent-loop-graphql'

/**
 * @extends {BaseAgentProgressSubscriptionResolver}
 */
export default class OnResearchProgressSubscriptionResolver extends BaseAgentProgressSubscriptionResolver {
  /** @override */
  static get schema () {
    return 'onResearchProgress' // ← the corresponding GraphQL subscription name
  }

  /** @override */
  get channel () {
    return 'researchProgress' // ← must be the same string as the Worker's channel
  }

  /** @override */
  generateChannelQuery ({
    variables,
  }) {
    return {
      // The scope key set must match the key set the Worker's buildScope returns.
      userId: variables.input.userId,
    }
  }

  /**
   * Pass the Worker's raw event straight through.
   *
   * @override
   */
  resolve (payload) {
    return payload
  }
}
```

- **Why override `resolve` to pass through**: renchan's Subscription base sometimes assumes it should
  unwrap `payload[schema]`. The Worker publishes a raw `{ phase, ... }` event, so returning it **as-is**
  with `resolve(payload) => payload` lets the frontend receive the Worker's event shape directly. Only
  reshape here if you want to change the event shape.
- **Match `channel` and scope with the publish side**: `get channel()` must be the same string as the
  Worker's `get channel()`, and the scope keys of `generateChannelQuery` must match the scope keys of
  the Worker's `buildScope`. Why: a mismatch publishes to a channel nobody subscribes to and progress
  never arrives, a silent failure (see "keep the progress channel identical" in
  [renchan-job-integration.md](./renchan-job-integration.md)). Define the `channel` string in one place
  and share it with the Worker.

## How progress arrives (the full flow)

```
RequestResearchMutationResolver.resolve
  → buildJobBody → enqueue → context.share.jobDispatcherProvider.dispatchJob(...) → returns { accepted, jobId } immediately
  → the Worker picks it up → loop.run({ input: body, onProgress }) inside executeJob
  → onProgress → job.updateProgress(event) → onJobProgress
  → publish to the channel AgentTopic.create({ channel: 'researchProgress', scope }).value
  → OnResearchProgressSubscriptionResolver (subscribing to the same channel + scope) → delivered to the frontend
```

The publish side (the Worker) and the subscribe side (this resolver) share the **core `AgentTopic`**
that `generateChannel` calls internally, so the channel names match structurally. To change the naming
rule, set the same `AgentTopic`-extended class as both sides' `AgentTopicCtor` (never change only one
side).

## Registering the GraphQL schema

Register the Mutation (`requestResearch: RequestResearchOutput`) and the Subscription
(`onResearchProgress: ...`) in the app's GraphQL schema, matching the name each resolver's `schema`
getter returns. Authentication, authorization, and input validation put these two resolvers on the same
path as any other renchan resolver.

- **In a non-GraphQL setup** (REST / tRPC, etc.), this package is unnecessary. Publish `onProgress` to
  the broker in the app and subscribe to the core `AgentTopic` channel directly (the publish/subscribe
  matching principle is the same).
