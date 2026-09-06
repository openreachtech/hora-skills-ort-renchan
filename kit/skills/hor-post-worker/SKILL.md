---
name: hor-post-worker
description: >
  Implement a GraphQL post-worker: a hook that fires after a query/mutation resolver has resolved
  and the response has been sent, to run a side effect that is not part of the API's main
  processing (send a welcome email after signup, emit an audit log, invalidate a cache). Use this
  skill whenever the user asks to add or edit a post-worker, wants "run something after this
  resolver / after the response", or needs to fire-and-forget a side effect right after an API
  call.
---

# Post-Worker (a post-response side-effect hook)

A skill for implementing `BaseGraphqlPostWorker`, a hook that runs a side effect — one that is *not*
part of the API's main processing — **after** the resolver has resolved (after the response has been
sent). It handles requirements of the form "after this operation, also run …" as a follow-up, without
polluting the resolver itself.

Deciding the placement itself (whether a post-worker is even the right choice, versus enqueuing inside
the resolver) is settled in section 2.2 of `hor-execution-placement-pattern`. This skill covers "once
you've decided on a post-worker, how to implement it". The implementation of the worker body you
dispatch to belongs to `hor-renchan-job-bullmq`.

## Grand principle: a post-worker is a thin layer that only dispatches — the real work always lives in the worker

The only things you may write in a post-worker's `onResolved()` are **the dispatch to a background
worker and the branching that precedes it**. **Write no real work at all** — no email-body assembly,
no external API calls, no DB updates, no heavy loops.

- **Why only dispatch**: a post-worker fires **after** the HTTP response has been fully sent (Express's
  `res.on('finish')`). Throwing an exception here **never reaches the caller, and neither retry,
  progress notification, nor monitoring apply**. Put real work here and logic accumulates in a place
  where failures get swallowed. Keep it to dispatch and the real work runs on the worker's machinery
  (retries, observability, scaling), while the post-worker stays predictably thin — "just enqueuing".
- **Why add a post-worker layer at all**: for something like "I don't want to make the signup response
  wait, but I do want to send a welcome email" — writing a **side effect unrelated to the main
  processing** into the resolver itself bloats the resolver's responsibility and lets a side-effect
  failure drag down the main processing's response. Push it out to a post-worker and the resolver can
  focus on returning its proper result.
- **If the decision touches "heavy / want to retry", go to the worker.** A post-worker is itself a thin
  hook that is never re-run, so any processing that must not fail, or that takes time, always belongs
  in the worker you dispatch to.

```js
// Good: the post-worker only dispatches (the real work of the side effect is on the worker side)
/** @override */
async onResolved ({
  variables,
  context,
  information,
  response: {
    output,
    error,
  },
}) {
  if (error) {
    return
  }

  await context.share.jobDispatcherProvider.dispatchJob({
    DispatcherCtor: SendWelcomeEmailJobDispatcher,
    body: {
      customerId: output.customer.id,
    },
  })
}
```

```js
// Avoid: writing email-body assembly or sending logic directly in the post-worker
//   → real work accumulates in a post-response place where failures get swallowed, and neither retry nor monitoring apply. Put the real work in the worker.
async onResolved ({ output }) {
  const html = await this.buildWelcomeMailHtml({ output }) // real work
  await this.mailer.send({ to: output.customer.email, html }) // external I/O — if it fails, no one notices
}
```

## Comment language in the sample code

Comments in the `js` examples in this SKILL.md follow the prose language (here, **English**), because
the examples are *explanation* of the skill. Comments inside the **artifact this skill produces** (the
real `*PostWorker.js` code) follow the **codebase** language — English — to match the surrounding source.

## 1. How it works (when it fires and what it receives)

A post-worker is a hook **per operation (query / mutation)**. The framework (renchan) fires it in the
following flow.

1. When the resolver resolves (or throws), the framework stores
   `{ variables, context, information, response }` bound to the request (`response` is
   `{ output, error: null }` on success, `{ output: null, error }` on failure).
2. **After the HTTP response has been fully sent** (`res.on('finish')`), using the stored content, it
   fires in this order:
   - first the engine-wide `defineOnResolved()` (a noop by default, **common to all operations**),
   - then the `onResolved()` of **the post-worker whose name matches that operation**.

- **The correspondence to an operation is by name match.** A post-worker is called only when the string
  returned by its `static get schema()` matches the fired operation's name (the GraphQL field name,
  e.g. `signUp`). **One post-worker per operation** (don't define the same `schema` more than once).
- `onResolved()` receives the **same `context`** as the resolver. This is the key point: because
  `context` reaches the shared instances (the job dispatcher, etc.), a post-worker can dispatch a worker
  ([2](#2-dispatch-a-worker-from-contextshare)).
- `variables` is the operation's input arguments, `output` is the resolver's return value, and
  `information` is the resolve info (`fieldName`, etc.).

Arguments `onResolved()` receives:

| Argument | Contents |
| --- | --- |
| `variables` | The operation's input arguments (the same ones the resolver received) |
| `context` | The same context as the resolver. `context.share` holds the shared instances ([2](#2-dispatch-a-worker-from-contextshare)) |
| `information` | GraphQL resolve info (`fieldName` = the operation name, etc.) |
| `response.output` | The resolver's return value (on success). `null` on failure |
| `response.error` | The error the resolver threw (on failure). `null` on success |

## 2. Dispatch a worker from `context.share`

A post-worker receives the same `context` as the resolver, and `context` has **`share`**. `share` holds
the instances the app uses in common, and in many renchan apps it keeps the **renchan-job-bullmq
dispatch entry point** (`jobDispatcherProvider`). A post-worker uses this to enqueue a worker.

```js
// Dispatch via share (a JobDispatcherProvider that reuses the connection)
await context.share.jobDispatcherProvider.dispatchJob({
  DispatcherCtor: SendWelcomeEmailJobDispatcher, // the Dispatcher of the job to enqueue
  body: {
    customerId: output.customer.id, // keep the body minimal (just ids or tokens)
  },
})
```

- **Why use `context.share`**: taking the dispatch entry point from the request-scoped shared instance
  lets you reuse the connection to Redis, etc. Don't `new` a Dispatcher every time inside the post-worker.
- The implementation of **the job you dispatch (Manifest / Worker / Dispatcher)** follows
  `hor-renchan-job-bullmq`. The post-worker side only decides "which Dispatcher, with what
  body" to enqueue.
- What's in `share` is app-dependent. Confirm the name of the dispatch entry point
  (`jobDispatcherProvider`, etc.) in that app's Share implementation. **If it's missing, the right move
  is to add it to share** — don't create a connection on the fly inside the post-worker.

## 3. Implementation steps

Steps to add one new post-worker.

### Step 1: Create the post-worker class

Extend `BaseGraphqlPostWorker` and override the following two. The file name is `<Operation>PostWorker.js`
(a name that makes the corresponding operation clear; align it with the resolver's naming).

- `static get schema()`: returns the **operation name** to hook (the GraphQL field name).
- `async onResolved({ variables, context, information, response })`: write dispatch only (the grand
  principle at the top of this file).

```js
import {
  BaseGraphqlPostWorker,
} from '@openreachtech/renchan'

import SendWelcomeEmailJobDispatcher from '../../../../app/jobs/send-welcome-email/SendWelcomeEmailJobDispatcher.js'

/**
 * Post-worker: dispatch a welcome email after signUp resolves.
 *
 * @extends {BaseGraphqlPostWorker<*, *, *>}
 */
export default class SignUpPostWorker extends BaseGraphqlPostWorker {
  /**
   * get: Operation name to hook.
   *
   * @override
   * @returns {string}
   */
  static get schema () {
    return 'signUp'
  }

  /**
   * On resolved hook. Dispatch only; the real work lives in the worker.
   *
   * @override
   */
  async onResolved ({
    variables,
    context,
    information,
    response: {
      output,
      error,
    },
  }) {
    if (error) {
      return
    }

    await context.share.jobDispatcherProvider.dispatchJob({
      DispatcherCtor: SendWelcomeEmailJobDispatcher,
      body: {
        customerId: output.customer.id,
      },
    })
  }
}
```

### Step 2: Guard against failures and missing values

- **If there's an `error`, return early.** Enqueuing a side effect (like sending an email) when the
  operation failed creates inconsistency. The standard guard is `if (!output || error) { return }` —
  treat a missing `output` the same as a failure.
- **Check that the values you read from `output` exist.** A post-worker runs after the resolver
  succeeds, but if `output`'s shape differs from what you expect, traverse it defensively like
  `output?.customer?.id` and don't dispatch when it's absent.
- **Don't throw from `onResolved()`.** It's after the response has been sent, so no one can catch it.
  Handle it with branching and return early.
- **Don't declare an `errorCodeHash` getter on a post-worker.** Unlike a resolver, a post-worker has
  no error contract with the caller (the response is already sent), so failures are handled by
  branching and early returns, not by raising error codes.

### Step 3: Wire it into the engine (`postWorkersPath`)

Post-workers are **auto-loaded recursively** from the directory the engine's `config.postWorkersPath`
points at (only classes extending `BaseGraphqlPostWorker` are picked up). While `postWorkersPath` is
`null`, post-workers **never fire at all**.

- Following the resolver layout, prepare a per-role directory like
  `server/graphql/post-workers/<role>/` and point `postWorkersPath` at it.

```js
// server/graphql/CustomerGraphqlServerEngine.js
/** @override */
static get config () {
  return {
    // ...existing config...
    actualResolversPath: rootPath.to('server/graphql/resolvers/customer/actual/'),
    // Before: postWorkersPath: null,
    postWorkersPath: rootPath.to('server/graphql/post-workers/customer/'),
  }
}
```

- If you need **engine-wide post-processing (common to all operations)**, override the engine's
  `defineOnResolved()` rather than a post-worker under `postWorkersPath`. The "dispatch only" principle
  still applies here too. Use them separately: **a post-worker for a specific operation's
  post-processing, `defineOnResolved()` for post-processing across all operations.**

## 4. Use cases (what to put in a post-worker)

All of these are **side effects unrelated to the main processing that you don't want to make the
response wait for**, and in the post-worker you **only dispatch**.

| Use case | Example operation to hook | What the dispatched worker does |
| --- | --- | --- |
| Notification email right after signup | `signUp` | Generate and send the welcome email body |
| Recording an audit log / operation history | Each mutation | Write the changes to the audit store |
| Syncing to an external system / webhook notification | `createXxx` / `updateXxx` | Push to the external API (external API client) |
| Cache invalidation / rebuild | Data-updating mutations | Delete and warm up the cache |
| Sending analytics events | Any operation | Send measurement events to analytics |

- **What a post-worker is not suited for**: processing whose result **the caller waits for / is included
  in the response** is too late in a post-worker (since it runs after the response). Handle that in the
  resolver itself, or with enqueuing inside the resolver (`hor-execution-placement-pattern` 2.1).

## 5. Testing

A post-worker has thin logic (dispatch only), so keep its tests thin too. Following the `hoc-jest` skill,
split files per class.

- That it extends `BaseGraphqlPostWorker` (inheritance).
- That `static get schema()` returns the **correct operation name**.
- The branching in `onResolved()`:
  - **On success** (`error: null`, `output` present) → **dispatch is called** with the expected
    `DispatcherCtor` and `body`.
  - **On failure** (`error` present) → **dispatch is not called** (early return).
- Stub the dispatch entry point. Replace `context.share.jobDispatcherProvider.dispatchJob` with a
  `jest.fn()` and verify the arguments (`DispatcherCtor` / `body`). **Don't actually enqueue a job.**

```js
// Success case: verify only that dispatch is called with the correct Dispatcher and body
const dispatchJobSpy = jest.fn()
const context = {
  share: {
    jobDispatcherProvider: {
      dispatchJob: dispatchJobSpy,
    },
  },
}

await SignUpPostWorker.create({ engine })
  .onResolved({
    variables: {},
    context,
    information: {},
    response: {
      output: {
        customer: {
          id: 'fake-customer-id-001',
        },
      },
      error: null,
    },
  })

expect(dispatchJobSpy)
  .toHaveBeenCalledWith({
    DispatcherCtor: SendWelcomeEmailJobDispatcher,
    body: {
      customerId: 'fake-customer-id-001',
    },
  })
```

## Finishing checklist

- [ ] Is what you wrote in `onResolved()` **only dispatch and branching** (did you put the real work in the worker)?
- [ ] Does `static get schema()` match the **operation name** it hooks (one post-worker per operation)?
- [ ] Do you return early when there's an `error`, and guard against a missing `output`? Are you not throwing from `onResolved()`?
- [ ] Is the dispatch via `context.share`'s shared dispatch entry point (not `new`-ing a connection inside the post-worker)?
- [ ] Did you wire the engine's `postWorkersPath` (it won't fire while it stays `null`)?
- [ ] Did you use `defineOnResolved()` for post-processing across all operations and a post-worker for a specific operation, appropriately?
- [ ] In tests, did you verify "dispatched on success / not on failure" with a stub of the dispatch entry point?
