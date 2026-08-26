# Adding authentication

How a subscription decides who may subscribe. Referenced from §2 of [SKILL.md](../SKILL.md). Names are
illustrative fakes — use your project's own.

## The gate: `canSubscribe`

Authorization happens **once, at subscribe time**, in **`canSubscribe`** — a boolean predicate.
Returning `false` makes the base throw the subscribe-denied error, so also declare that error code in
`errorCodeHash`.

```js
/** @override */
static get errorCodeHash () {
  return {
    ...super.errorCodeHash,

    CanNotSubscribe: '102.S001.001',
  }
}

/**
 * Whether the caller may subscribe to this channel.
 *
 * @override
 * @param {{
 *   variables: OnReceiveMessageVariables
 *   context: GraphqlType.ResolverInputContext
 * }} params - Parameters.
 * @returns {Promise<boolean>}
 */
async canSubscribe ({
  variables,
  context,
}) {
  return context.hasAuthenticated()
}
```

## Patterns

- **Authenticated-only** — the caller must be a valid principal:

  ```js
  async canSubscribe ({
    context,
  }) {
    return context.hasAuthenticated()
  }
  ```

- **Resource-scoped** — the caller must own or belong to what they subscribe to. Combine the
  principal with the input, and keep `canSubscribe` a predicate by doing the lookup in a separate
  method:

  ```js
  async canSubscribe ({
    variables,
    context,
  }) {
    if (!context.hasAuthenticated()) {
      return false
    }

    return this.isMemberOfRoom({
      variables,
      context,
    })
  }
  ```

- **Identity-scoped channel** — for a private stream, also derive the channel from the principal in
  `generateChannelQuery` (e.g. include `context.userId`), so a subscriber can only *build* a channel
  for their own data. Authorization and channel scoping then reinforce each other: even a caller who
  passes `canSubscribe` receives only events on their own channel.

  ```js
  generateChannelQuery ({
    context: {
      userId,
    },
  }) {
    return {
      userId,
    }
  }
  ```

## Timing

- `canSubscribe` runs **when the subscription is established, not per message** — it is a cheap,
  one-time gate. Do not put per-message filtering here.
- This is the subscription's **own** gate. It is in addition to any endpoint-wide authentication
  filter the server applies before a resolver runs; the two are independent — the endpoint filter
  decides "may this caller reach this operation at all", `canSubscribe` decides "may this caller open
  this specific channel".
- Because the decision is a plain boolean derived from `context` (and optionally `variables`),
  `canSubscribe` is trivial to unit-test: feed a context with and without an authenticated principal
  and assert the boolean.
