# Integrating with subscriptions (progress → GraphQL)

How a worker in the Job Daemon streams progress to a GraphQL subscription in the API process, over
the shared Redis PubSub broker. Referenced from §4 of [SKILL.md](../SKILL.md).

## The two sides

- **Publisher** = a worker in the **Job Daemon** process.
- **Subscriber** = a GraphQL subscription resolver in the **GraphQL API** process.
- **Transport** = one `SubscriptionBroker` (Redis PubSub) that both processes point at (same Redis as
  the queues — [engine-and-infra.md](./engine-and-infra.md)).

A message is delivered by matching **channel** + **scope**. Scope namespaces the channel so a given
customer only receives their own job's progress.

## Publish side (worker)

The Daemon builds the broker and injects it into the Engine
([daemon-and-scheduler.md](./daemon-and-scheduler.md#path-b--with-a-progress-broker-this-repo)); the
Share then exposes it. Enqueue-only processes never inject a broker, so `subscriptionBroker` is
`null` and publishing is a no-op.

For AI jobs, `BaseAgentJobWorker` (from `@openreachtech/mentsu-agent-loop-renchan-job`) already turns
the lifecycle hooks into publishes: `onJobProgress` → `publishProgress({ topic, event })`,
`onJobCompleted` → `{ phase: 'done', payload: result }`, `onJobFailed` → an error event. It builds the
`topic` from `channel` + `buildScope({ jobModel })`.

This repo's app base `BaseContentGenerationJobWorker.js`
customizes it:

```js
/** @override */
get channel () {
  return 'reportProgress' // must equal the subscription resolver's channel
}

/** @override */
buildScope ({ 
  jobModel, 
}) {
  const body = jobModel.denormalizedBody

  // public-lp jobs scope by accessToken (the customer's key); internal jobs fall back to jobId
  if (body.accessToken) {
    return {
      accessToken: body.accessToken,
    }
  }

  return {
    jobId: body.jobId,
  }
}

/** @override */
publishProgress ({
  topic,
  event,
}) {
  if (!this.subscriptionBroker) {
    return null // enqueue-only process: no broker, no publish
  }

  // adapt to renchan SubscriptionBroker's { channel, message } signature
  return this.subscriptionBroker.publish({
    channel: topic,
    message: event,
  })
}
```

(It also persists progress / result / failure to the DB inside the overridden `onJob*` hooks, then
calls `super` to publish.)

## Subscribe side (GraphQL)

The GraphQL server resolves the subscription with a **matching channel and scope**
(`OnReportProgressSubscriptionResolver.js`):

```js
export default class OnReportProgressSubscriptionResolver extends BaseAgentProgressSubscriptionResolver {
  /** @override */ static get schema () { return 'onReportProgress' }

  /** @override */
  get channel () {
    return 'reportProgress' // matches the worker's channel
  }

  /** @override */
  generateChannelQuery ({
    variables,
  }) {
    // matches the worker's buildScope
    return {
      accessToken: variables.input.accessToken,
    }
  }

  /** @override */
  resolve (payload) {
    return payload // forward the worker's raw progress event
  }
}
```

## Checklist

- **Channel string identical** on both sides (`'reportProgress'`).
- **Scope keys identical** on both sides (`{ accessToken }`) — this is why the public-lp queue body
  carries `accessToken` ([queues.md](./queues.md)).
- **Same Redis** for the Daemon's broker and the API's broker.
- **Daemon injects the broker** (Path B); the enqueue path does not (publish becomes a no-op).
- After a `done` / `error` event, the client typically re-queries for the final persisted result.
