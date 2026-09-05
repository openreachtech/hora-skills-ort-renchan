---
name: hor-subscription-resolver
description: >
  Implement a GraphQL subscription resolver — a class extending the framework's base subscription
  resolver that declares the subscription operation, scopes its channel per subscriber, and gates
  who may subscribe. Use this skill whenever the user asks to add or change a subscription, scope
  or authorize a subscription channel, or wire the publish side that pushes events to subscribers.
---

# Subscription Resolver

A skill for **GraphQL subscription resolvers**: the class that lets a client **subscribe to a
channel** and receive a **stream of pushed events**. It declares the operation, decides **which
channel** a caller listens on, and **whether they may**. The events themselves are **published** by
whatever changes state (a mutation or a background worker), through a PubSub **broker** — the
subscription resolver and the publisher meet on a named channel, never calling each other directly.

This overview maps each topic to a section; the details are in the detail files under `references/`.

> This skill states a **general, project-independent rule** — a refined best practice, not a
> description of any one project's code, so it need not match a given repo's existing notation. The
> class and field names (`OnReceiveMessageSubscriptionResolver`, `onReceiveMessage`, `roomId`, …) are
> **illustrative fakes**; use your project's own names and never bake its domain or file paths into
> the rule. The framework base is shown as `BaseSubscriptionResolver`; treat it as "your framework's
> base subscription resolver". Sample code follows the project's lint style (no semicolons, 2-space
> indent, a space before the parameter parenthesis, trailing commas).

## Grand principle: the resolver owns the channel; the state-changer publishes to it

A subscription resolver is a **read-only push endpoint**. It does two things: **name and scope the
channel** a subscriber listens on, and **decide if that subscriber is allowed**. It never mutates
state and it does not produce the events — a **mutation or worker publishes** them onto the same
channel, and the broker fans them out to every matching subscriber.

- **The subscription resolver is the single source of truth for the channel contract.** The channel
  name is derived from the resolver's `schema` (the prefix) plus its `generateChannelQuery` (the
  scope). The publisher builds its message via the **same class** (`buildTopic`), so the two sides
  can never disagree on the channel — that is why a publisher imports the subscription resolver.
- **The broker decouples the two sides.** Subscriber and publisher share only a channel string; they
  can live in **different processes** (e.g. a background worker publishes; the API process serves the
  subscription).
- **Keep it thin.** Scope, authorize, unwrap. No business logic, no writes.

## 1. Basic notation

A subscription resolver extends the framework base and overrides a small, fixed set of members. Every
per-call method receives the **same four arguments** — `{ variables, context, information, parent }`
(destructure what you need). The essential members:

| Member | Override? | Role |
| --- | --- | --- |
| `static get schema ()` | **required** | the subscription operation name — also the **channel prefix** and the **message key** |
| `generateChannelQuery ({ variables, context, … })` | usually | key/value hash that **scopes** the channel per subscriber; default `{}` = broadcast to all |
| `async canSubscribe ({ variables, context, … })` | for auth ([§2](#2-adding-authentication)) | boolean subscribe-time gate; default `true` |
| `static get errorCodeHash ()` | when adding auth | merge `...super.errorCodeHash` + the subscribe-denied code |
| `resolve (payload)` | rarely | maps the published message to the returned value; the base unwraps `payload[schema]` |
| `static get operation` / `channelPrefix` / `subscribe` / `buildTopic` / `publishTopic` | **no** | provided by the base — the subscribe flow, channel building, and publish helpers |

The class skeleton, the common-arguments table, the full example, and the `@typedef` shapes are in
[basic-notation.md](./references/basic-notation.md).

## 2. Adding authentication

Authorization happens **once, at subscribe time**, in **`canSubscribe`** — a boolean gate. Returning
`false` makes the base throw the subscribe-denied error, so also declare that error code in
`errorCodeHash`. Authenticated-only is `return context.hasAuthenticated()`; resource-scoped access
combines the principal with the input; private streams are additionally scoped by principal in
`generateChannelQuery`.

The full `canSubscribe` / `errorCodeHash` example, the authenticated / resource-scoped / identity
patterns, and the once-per-subscribe note are in [authentication.md](./references/authentication.md).

## 3. Design philosophy

- **Read-only push; the state-changer publishes.** The resolver opens a scoped, authorized channel;
  the mutation/worker that changes state publishes to it after the change commits.
- **One channel contract, one owner.** Both sides derive the channel from the same subscription
  resolver class — the subscriber via `generateChannelQuery`, the publisher via `buildTopic` — so the
  prefix and scope can never drift.
- **Scoping = per-subscriber isolation**, and the **broker** lets the publisher run in a separate
  process from the API. Keep the payload minimal and `resolve` thin.

The publish-side example and the full rationale are in
[design-philosophy.md](./references/design-philosophy.md).

## Finishing checklist

- [ ] `static get schema` returns the subscription operation name (= channel prefix = message key) ([§1](#1-basic-notation)).
- [ ] `generateChannelQuery` scopes the channel per subscriber (or `{}` only for a true broadcast).
- [ ] The resolver does **no** writes and **no** business logic — it scopes, authorizes, and unwraps.
- [ ] If access is restricted: `canSubscribe` returns the boolean gate and `errorCodeHash` declares the subscribe-denied code ([§2](#2-adding-authentication)); private channels are also scoped by principal.
- [ ] The publisher (mutation/worker) builds its topic via **this class's** `buildTopic` and publishes through the broker — no hand-written channel string ([§3](#3-design-philosophy)).
- [ ] The published payload is minimal; `resolve` is left to the base unless a reshape is needed.

## Detail files

- [basic-notation.md](./references/basic-notation.md) — the class skeleton, the common
  `{ variables, context, information, parent }` arguments, the member table in full, the example, and
  the `@typedef` input/response shapes (§1)
- [authentication.md](./references/authentication.md) — `canSubscribe` as the boolean gate,
  `errorCodeHash`, the authenticated / resource-scoped / identity-scoping patterns, subscribe-time
  timing (§2)
- [design-philosophy.md](./references/design-philosophy.md) — read-only push, the single channel
  contract and the publish-side example, per-subscriber isolation, broker decoupling, minimal payload
  (§3)
