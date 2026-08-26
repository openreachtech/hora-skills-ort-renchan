# Splitting queues

How to run work across multiple queues, share worker logic safely, and scale queues independently.
Referenced from §5 of [SKILL.md](../SKILL.md).

## One queue == one job directory == one Manifest `jobName`

To add a queue, add a job directory whose Manifest returns a new `jobName`
([job-triple.md](./job-triple.md)). The Daemon discovers and listens on every queue whose worker
lives under `workersPath`; on boot it logs one `Listening: <jobName>` per queue.

This repo splits the *same* content-generation work into two queues so they can be secured, scaled, and
subscribed-to independently:

| Queue (`jobName`) | Body | Enqueued from | Progress scope |
| --- | --- | --- | --- |
| `content-generation-internal` | `{ jobId }` | admin GraphQL + integration REST | `jobId` (no subscription) |
| `content-generation-public-lp` | `{ jobId, accessToken }` | public LP GraphQL | `accessToken` (customer subscription) |

Both are enqueued the same way, just with a different `DispatcherCtor`:

```js
// public LP resolver
await context.share.jobDispatcherProvider.dispatchJob({
  DispatcherCtor: ContentGenerationPublicLpJobDispatcher,
  body: { 
    jobId, 
    accessToken, 
  },
})

// admin / integration
await context.share.jobDispatcherProvider.dispatchJob({
  DispatcherCtor: ContentGenerationInternalJobDispatcher,
  body: { 
    jobId, 
  },
})
```

## Share logic with a base worker — but place it OUTSIDE `workersPath`

Both workers `extends BaseContentGenerationJobWorker` (the app base) and differ only in
`ManifestCtor` — so the queues share all the real logic.

- **Gotcha:** that shared abstract base lives in `app/` — **outside `workersPath` (`app/jobs`)**. The
  Daemon's `DeepBulkClassLoader` boots *every* `BaseJobWorker` subclass found under `workersPath`, and
  an abstract base has no `jobName`, so leaving it under `app/jobs/**` would crash daemon startup.
  **Keep only concrete workers under `app/jobs/**`; put shared bases elsewhere in `app/`.**

```
app/
├── BaseContentGenerationJobWorker.js        # shared base — NOT under app/jobs
└── jobs/
    ├── content-generation-internal/ContentGenerationInternalJobWorker.js   # concrete
    └── content-generation-public-lp/ContentGenerationPublicLpJobWorker.js  # concrete
```

## Run a subset of queues per Daemon (`skipJobHash`)

One Daemon process listens on all discovered queues by default. To run a **subset** per process — e.g.
put a heavy queue on its own machine — the engine/daemon supports a `skipJobHash`
(`{ [jobName]: true }`) that filters those worker constructors out at boot. Start one Daemon that
skips the heavy queue and another that runs only it, both against the same Redis.

## Tune each queue independently

- **Producer defaults** — the Dispatcher's `static optionHash` (BullMQ `QueueOptions`), e.g.
  `defaultJobOptions: { attempts: 3 }`.
- **Consumer throughput** — the Worker's `buildOptionHash()` (BullMQ `WorkerOptions`), e.g.
  `concurrency` and `limiter` (rate limiting; see `app/tools/ContentGenerationRateLimiter.js`).

Because these are per class, two queues that share a base worker can still carry different
concurrency / attempts / limiter settings.
