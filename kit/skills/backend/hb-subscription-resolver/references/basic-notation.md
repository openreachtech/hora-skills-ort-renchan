# Basic notation — members & common arguments

The class skeleton, the arguments every method receives, and the member contract. Referenced from §1
of [SKILL.md](../SKILL.md). Class and field names (`OnReceiveMessageSubscriptionResolver`,
`onReceiveMessage`, `roomId`, …) are illustrative fakes — use your project's own names.

## Common arguments

Every per-call method on a subscription resolver receives the **same four arguments**. Destructure
only what the method needs.

| Argument | What it is |
| --- | --- |
| `variables` | the subscription's input arguments |
| `context` | the per-request context — the auth principal, and the PubSub broker (`context.broker`) |
| `information` | GraphQL resolve info (the operation/field name) |
| `parent` | the parent resolver's output (typically absent at the subscription root) |

## Members

A subscription resolver extends the framework base and overrides a small, fixed set of members. The
rest of the subscribe flow (channel building, the async iterable, the publish helpers) is provided by
the base and is **not** overridden.

| Member | Override? | Role |
| --- | --- | --- |
| `static get schema ()` | **required** | the subscription operation name — also the **channel prefix** and the **message key** |
| `generateChannelQuery ({ variables, context, … })` | usually | key/value hash that **scopes** the channel per subscriber; default `{}` = broadcast to all |
| `async canSubscribe ({ variables, context, … })` | for auth ([authentication.md](./authentication.md)) | boolean subscribe-time gate; default `true` |
| `static get errorCodeHash ()` | when adding auth | merge `...super.errorCodeHash` + the subscribe-denied code |
| `resolve (payload)` | rarely | maps the published message to the returned value; the base unwraps `payload[schema]` |
| `static get operation` | **no** | fixed to the subscription operation kind |
| `static get channelPrefix` | **no** | defaults to `schema` |
| `subscribe` / `generateChannel` / `generateAsyncIterable` | **no** | the base subscribe flow |
| `static buildTopic` / `static publishTopic` | **no** (call, don't override) | the publish-side helpers used by the state-changer ([design-philosophy.md](./design-philosophy.md)) |

## The skeleton

```js
import {
  BaseSubscriptionResolver,
} from '@openreachtech/renchan'

/**
 * Subscription resolver: push new messages of a room to its subscribers.
 *
 * @extends {BaseSubscriptionResolver<OnReceiveMessageVariables, OnReceiveMessageResponse>}
 */
export default class OnReceiveMessageSubscriptionResolver extends BaseSubscriptionResolver {
  /** @override */
  static get schema () {
    return 'onReceiveMessage'
  }

  /** @override */
  static get errorCodeHash () {
    return {
      ...super.errorCodeHash,
    }
  }

  /**
   * Scope the channel per subscriber (here: by room).
   *
   * @override
   * @param {{
   *   variables: OnReceiveMessageVariables
   * }} params - Parameters.
   * @returns {Record<string, string | number>} Channel query.
   */
  generateChannelQuery ({
    variables: {
      input: {
        roomId,
      },
    },
  }) {
    return {
      roomId,
    }
  }
}

/**
 * @typedef {{
 *   input: {
 *     roomId: number
 *   }
 * }} OnReceiveMessageVariables
 */

/**
 * @typedef {{
 *   onReceiveMessage: {
 *     message: {
 *       id: number
 *       content: string
 *     }
 *   }
 * }} OnReceiveMessageResponse
 */
```

## Notes on each member

- **`schema`** is the one required member: it is the operation name **and** the channel prefix **and**
  the key the payload is wrapped under. Keep it identical to the GraphQL field.
- **`generateChannelQuery`** returns the values that narrow the channel. Return `{}` only when every
  subscriber genuinely wants every event. The base calls it inside `subscribe`; you never call
  `subscribe` yourself.
- **`errorCodeHash`** starts as a spread of `super.errorCodeHash`; add codes only when the resolver
  introduces its own errors (e.g. the subscribe-denied code once you add `canSubscribe`).
- **`resolve (payload)`** is left to the base unless the pushed message must be reshaped before it
  reaches the client; the default returns `payload[schema]`.
- The `@typedef` blocks give the input (`Variables`) and pushed-message (`Response`) shapes — the
  `Response` object is keyed by `schema`.
