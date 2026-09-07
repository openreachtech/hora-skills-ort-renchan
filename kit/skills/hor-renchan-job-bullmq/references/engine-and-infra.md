# Engine / Share / Context / RedisConnection

The shared infrastructure every job points at. Referenced from §2 of [SKILL.md](../SKILL.md).

## Engine — the one config object

A `BaseJobEngine` subclass (`app/ContentGenerationJobEngine.js`)
is the single place that names paths, Redis, the Share/Context constructors, error codes, and log
files. Every Dispatcher / Worker / Scheduler references it via `EngineCtor`.

```js
export default class ContentGenerationJobEngine extends BaseJobEngine {
  /** @override */
  static get config () {
    return {
      workersPath: rootPath.to('app/jobs'),      // Daemon scans here for BaseJobWorker subclasses
      schedulersPath: rootPath.to('app/jobs'),   // scheduler registration scans here
      redisConfig: RedisConnection
      .create()
      .generateConnectionOptions(),
    }
  }

  /** @override */ static get ShareCtor () { return ContentGenerationJobShare }
  /** @override */ static get ContextCtor () { return ContentGenerationJobContext }

  /** @override */
  static get standardErrorCodeHash () {
    return {
      Unknown: '100.X000.001',
      InvalidRequest: '103.X000.001',
    }
  }

  /** @override */ static get savingLogFilePath () { return rootPath.to('logs/content-generation-job.log') }
}
```

- **`config`** returns `{ workersPath, schedulersPath, redisConfig }`. Both paths point at `app/jobs`
  (the Daemon and scheduler-registration scan there).
- **`savingLogFilePath`** is the default per-job log file; **`savingLogFilePathLookup`** (optional) can
  map specific `jobName`s to their own files.
- **`createAsync({ subscriptionBroker })`** builds the Share, injecting the progress broker (see
  [subscriptions.md](./subscriptions.md)). Enqueue-only callers omit it (broker stays `null`).
- The engine exposes `buildDispatcherConfig()` / `buildSchedulerConfig()` / `buildWorkerConfig()`
  (all reading `redisConfig`), an `Error` hash built from `standardErrorCodeHash`, and per-role
  logger pools.

## Share — per-process shared bag

`BaseJobShare` subclass (`app/contexts/ContentGenerationJobShare.js`).
Created once per process by the engine; holds `processClerk`, `env`, `timber`, and (when injected)
the `subscriptionBroker`. The getter just returns the stored instance — no side effects. Enqueue-only
processes construct the Share with `subscriptionBroker: null`.

## Context — per-job DI object

`BaseJobContext` subclass. Created fresh for **each job execution** (`createAsync({ engine })`) and
handed to `executeJob` as `context`. Put per-job dependency resolution here (loaders, resolvers) so
the worker stays thin.

## RedisConnection — one Redis, two option shapes

`app/queue/RedisConnection.js` reads `REDIS_HOST` /
`REDIS_PORT` / `REDIS_PASSWORD` and produces:

- **`generateConnectionOptions()`** — for BullMQ queues/workers. **Must include
  `maxRetriesPerRequest: null`** (BullMQ requirement).
- **`generatePubSubOptions()`** — for the subscription broker (no `maxRetriesPerRequest`).

The **GraphQL API process and the Job Daemon must point at the same Redis** — that shared instance is
both the job queue and the progress-PubSub channel.

## Connections are established once, never per job

Both the subscription broker and each worker's Redis connection are established **once at Daemon
startup** and reused for the process's lifetime — never re-created inside a worker per job:

- The **subscription broker** is built once in the daemon entry script and injected via
  `Engine.createAsync({ subscriptionBroker })` → held on the Share. A worker only reads it
  (`this.subscriptionBroker`); it never constructs one. Enqueue-only processes inject none (`null`).
- Each **worker's BullMQ connection** is opened once when `JobWorkersDaemon.startDaemon()` builds and
  `setupWorker()`s the workers; the BullMQ `Worker` is a long-lived consumer. `executeJob` runs per
  job but reuses that open connection.
- On the **producer side**, `JobDispatcherProvider` plays the same role — it caches one dispatcher
  (queue producer connection) per `DispatcherCtor` and reuses it (`keepsConnection: true`), tearing
  down only at process exit. So do **not** `createAsync()` a fresh dispatcher per request.

This "connect once at boot, reuse per job" model is the framework's intended design.

## Package exports (quick reference)

`@openreachtech/renchan-job-bullmq` exports, among others:

| Export | Role |
| --- | --- |
| `BaseJobEngine` | central config |
| `BaseJobManifest` | queue name + body schema |
| `BaseJobWorker` | consumer |
| `BaseJobDispatcher` | producer |
| `BaseJobScheduler` / `BaseCronJobScheduler` / `BaseIntervalJobScheduler` | schedulers |
| `BaseJobSchedulerService` | schedule registration service |
| `BaseJobContext` / `BaseJobShare` | per-job / per-process DI |
| `JobWorkersDaemon` | worker daemon |
| `CronSchedule` / `IntervalSchedule` / `BaseSchedule` | schedule value objects |
| `JobBody`, `RenchanJobError`, `DeepBulkClassLoader`, `ProcessClerk`, `Timber` | tools |
