# Design philosophy

Why a subscription is split into a channel-owning resolver and a separate publisher. Referenced from
§3 of [SKILL.md](../SKILL.md). Names are illustrative fakes — use your project's own.

## Read-only push; the state-changer publishes

The subscription resolver only opens a **scoped, authorized channel** and streams from it. The event
is produced by whatever **changes state** — a mutation, or a background worker — which **publishes**
to the channel **after the change commits**. Never publish from inside the subscription resolver, and
never mutate state there.

- **Why**: publishing before the write commits would push an event that a later failure rolls back.
  Making the state-changer own the publish keeps "the change happened" and "subscribers were told"
  in the same place, in the right order.

## One channel contract, one owner

Both sides derive the channel from the **same subscription resolver class**: the subscriber via
`subscribe` → `generateChannelQuery`, the publisher via the class's `buildTopic`. The publisher
therefore **imports the subscription resolver** and never hand-writes a channel string — so the
prefix and scope can never drift apart.

```js
// In the state-changer (a mutation or a worker): build the topic from the SAME subscription resolver,
// then publish it through the broker on the context. The channel is never hand-written.
const topic = OnReceiveMessageSubscriptionResolver.buildTopic({
  payload: {
    message,
  },
  channelQuery: {
    roomId,
  },
})

await this.publishTopic({
  context,
  topic,
})
```

- The publisher's `channelQuery` **must match** the subscriber's `generateChannelQuery` output for
  the event to arrive. Because both come from one class, a change to the scope updates both sides at
  once.

## Scoping = per-subscriber isolation

`generateChannelQuery` narrows the channel so a subscriber receives only its own events:

- **By input** (`roomId`) — topic selection: the caller chooses which stream to listen to.
- **By principal** (`userId`) — privacy: the caller can only listen to their own stream
  ([authentication.md](./authentication.md)).

A broadcast channel (`generateChannelQuery` returns `{}`) is correct only when every subscriber
genuinely wants every event.

## Broker decoupling enables cross-process push

Subscriber and publisher share only a **channel string**, exchanged through the PubSub **broker**
(reached via the context / the app's shared instances). They never call each other. This is what lets
the publisher run in a **separate process** from the API that serves the subscription — for example a
background worker publishing progress that a client subscribed to in the API process.

## Minimal payload, thin `resolve`

Publish only what the client needs; the default `resolve` merely unwraps `payload[schema]`. Override
`resolve` only to reshape the pushed message, never to fetch or compute — keeping the payload small
and the resolver thin keeps the push path fast and the contract obvious.
