---
name: hor-renchan-job-bullmq
description: >
  Write and wire background jobs with @openreachtech/renchan-job-bullmq (BullMQ on Redis). Use
  this skill whenever the user asks to add or edit a job under app/jobs/** — a Manifest / Worker /
  Dispatcher triple, a cron or interval (repeatable) job, enqueuing from a GraphQL/REST resolver,
  publishing progress to a GraphQL subscription, the worker daemon entry point, splitting work
  across queues, or tuning concurrency / retries / rate limits.
---

# renchan-job-bullmq

`@openreachtech/renchan-job-bullmq` is this repo's job framework: **BullMQ queues on Redis**, wrapped
in renchan base classes. A job is a small **template of class files in one directory** under
`app/jobs/<job-name>/`. Two long-running processes share **one Redis** (`pm2.config.cjs`):

- **GraphQL API** (`server/index.js`) — handles requests and **enqueues** jobs (producer).
- **Job Daemon** (`scripts/startJobDaemon.js`) — **runs** the workers (consumer) and
  **publishes progress** back over Redis PubSub to the API's GraphQL subscriptions.

This overview maps each topic to a section; the specifics are in the detail files under
`references/`. The package's own usage samples live in `samples/confirm-01` (dispatch + daemon) and
`samples/confirm-02` (cron + interval schedulers) of the `hor-renchan-job-bullmq` package.

## Core principle: a job is a filled-in template of 3–4 files

Each job is a directory `app/jobs/<kebab-job-name>/` holding a fixed set of classes, each extending a
renchan base, all pointing at one central **Engine**:

| File | Base class | Responsibility |
| --- | --- | --- |
| `<Name>JobManifest.js` | `BaseJobManifest` | the **queue name** (`jobName`) + the **body schema** |
| `<Name>JobWorker.js` | `BaseJobWorker` | **consume**: `executeJob()` + lifecycle hooks |
| `<Name>JobDispatcher.js` | `BaseJobDispatcher` | **produce**: enqueue + per-queue `optionHash` |
| `<Name>CronJobScheduler.js` / `<Name>IntervalJobScheduler.js` | `BaseCronJobScheduler` / `BaseIntervalJobScheduler` | (scheduled jobs) register a repeatable job |

Keep the layout identical across jobs so review attention goes to the job's *logic*. Directory =
kebab = `jobName`; classes are PascalCase with those fixed suffixes. Structural comments are English;
the domain-explanation comments in the real files are Japanese (they cite the plan, `T-JOB-*`) —
match the surrounding code.

## 1. Basic usage — the Manifest / Worker / Dispatcher triple

- **Manifest** — `jobName` (the queue name, == the directory) + `bodySchema` (`ScalarHash` scalars
  `Text` / `Integer` / … from `@openreachtech/mentsu-schema`). Keep the body minimal (ids/tokens).
- **Worker** — `static get ManifestCtor()` + `async executeJob({ body, context, parcel })` + the four
  abstract lifecycle hooks (`onJobCompleted` / `onJobFailed` / `onJobProgress` / `onWorkerError`).
  **`executeJob`'s return value is stored in Redis — return only the minimum**, never entity arrays.
  Override `buildOptionHash()` for `concurrency` / `limiter`.
- **Dispatcher** — `static get EngineCtor()` + `static get ManifestCtor()` + optional
  `static get optionHash()` (BullMQ `QueueOptions`, e.g. `defaultJobOptions.attempts`). To stay DRY,
  a base app dispatcher can set `EngineCtor` once so each job dispatcher only sets `ManifestCtor`.

```js
// Manifest — the source of truth for the queue name and payload shape
export default class SendReportEmailJobManifest extends BaseJobManifest {
  /** @override */ static get jobName () { return 'send-report-email' }

  /** @override */
  static get bodySchema () {
    return {
      sessionToken: Text,
    }
  }
}
```

**Enqueue** from a resolver via the request-scope `JobDispatcherProvider` (connection reuse):

```js
await context.share.jobDispatcherProvider.dispatchJob({
  DispatcherCtor: SendReportEmailJobDispatcher,
  body: {
    sessionToken,
  },
})
```

Standalone (one-off): `const dispatcher = await Dispatcher.createAsync(); await dispatcher.dispatchJob({ body }); await dispatcher.teardown()`
— `dispatchJob` returns a response with `hasError()` / `hasResponse()` / `createDispatchedAt()`.

Full classes, hooks, the base-app-dispatcher pattern, and the enqueue paths are in
[job-triple.md](./references/job-triple.md).

## 2. Engine / Share / Context / RedisConnection

- **Engine** (`ContentGenerationJobEngine.js`) —
  the one config object: `config` = `{ workersPath, schedulersPath, redisConfig }` (both paths point
  at `app/jobs`), plus `ShareCtor` / `ContextCtor`, error codes, log path. `createAsync({ subscriptionBroker })`
  injects the progress broker (§4).
- **Share** — per-**process** DI (holds `subscriptionBroker` or `null`, `env`, `timber`, …).
- **Context** — per-**job** DI, created for each run and passed to `executeJob`.
- **RedisConnection** (`app/queue/RedisConnection.js`) —
  `generateConnectionOptions()` for BullMQ (**`maxRetriesPerRequest: null` required**) and
  `generatePubSubOptions()` for the broker. **API and Daemon must share one Redis.**

Details and the package-exports table are in [engine-and-infra.md](./references/engine-and-infra.md).

## 3. Entry points — the worker Daemon and the scheduler

**Worker Daemon** — `JobWorkersDaemon` auto-discovers every `BaseJobWorker` under `workersPath`
(`DeepBulkClassLoader`), binds each to its `jobName`, and installs graceful SIGINT/SIGTERM shutdown.
Two boot shapes:

- **Simple** (no progress broker): `JobWorkersDaemon.createAsync({ EngineCtor }).then(daemon => daemon.startDaemon())`.
- **With a broker** (this repo, `scripts/startJobDaemon.js`):
  build a `SubscriptionBroker`, inject it via `Engine.createAsync({ subscriptionBroker })`, then
  `JobWorkersDaemon.loadWorkerCtors({ engine })` → `.create({ engine, WorkerCtors }).startDaemon()`.

**Scheduler registration** is a **one-shot** script (`scripts/start-schedule.js`):
`SchedulerService.createAsync({ EngineCtor })` → `startAllSchedulers()` → exit. It writes repeatable
jobs to Redis; the Daemon consumes them. `stopAllSchedulers()` removes them without stopping the
Daemon.

**pm2** (`pm2.config.cjs`) runs `GraphQL API` and `Job Daemon`.

Both boot paths, cron **and interval** schedulers, and the start/stop scripts are in
[daemon-and-scheduler.md](./references/daemon-and-scheduler.md).

## 4. Integrating with subscriptions (progress → GraphQL)

A worker in the Daemon **publishes** progress on a `channel` namespaced by a `scope`; a GraphQL
subscription in the API process **subscribes** with the **same channel + scope**, over the shared
Redis PubSub broker.

- The Daemon injects the broker (§3, Path B); enqueue-only processes pass none → publish is a no-op.
- AI workers get this automatically from `BaseAgentJobWorker`; the app base
  `BaseContentGenerationJobWorker.js` sets
  `channel = 'reportProgress'` and `buildScope` (`accessToken` else `jobId`).
- The subscriber
  (`OnReportProgressSubscriptionResolver.js`)
  must match the channel and scope. This is why the public-lp queue body carries `accessToken` (§5).

The publish/subscribe wiring and checklist are in [subscriptions.md](./references/subscriptions.md).

## 5. Splitting queues

**One queue == one job directory == one Manifest `jobName`.** The repo splits the same content-generation
work into `content-generation-internal` (`{ jobId }`) and `content-generation-public-lp`
(`{ jobId, accessToken }`) so they scale and subscribe independently.

- **Share logic** via an app base worker, but **place that base OUTSIDE `workersPath`** — the Daemon
  boots every `BaseJobWorker` under `app/jobs`, and an abstract base without a `jobName` crashes
  startup. Only concrete workers go under `app/jobs/**`.
- Run a **subset** of queues per Daemon with `skipJobHash` (`{ [jobName]: true }`).
- Tune per queue: Dispatcher `optionHash` (attempts) + Worker `buildOptionHash()` (concurrency,
  limiter).

Details and the directory diagram are in [queues.md](./references/queues.md).

## 6. Other building blocks

- **Cron / interval jobs** — `BaseCronJobScheduler` (`{ cronExpression }`) or `BaseIntervalJobScheduler`
  (`{ millisecond, isImmediately }`), listed in `SchedulerService.collectScheduleInputs()` with a
  `schedulerId` matching the scheduler class. See [daemon-and-scheduler.md](./references/daemon-and-scheduler.md).
- **Connection reuse** — `JobDispatcherProvider`
  (`app/tools/JobDispatcherProvider.js`) caches one
  Dispatcher per `DispatcherCtor` and dispatches with `keepsConnection: true`; the request Share
  holds one, torn down on process exit. Prefer it over `Dispatcher.createAsync()` per request.
- **Retries & idempotency** — set `attempts` in `optionHash`; make `executeJob` idempotent (BullMQ may
  re-run). Expensive AI jobs checkpoint to `content_generations.intermediate_steps_json` and
  resume on retry.
- **Concurrency & rate limiting** — `buildOptionHash()` forwards `concurrency` + `limiter`
  (`app/tools/ContentGenerationRateLimiter.js`).
- **Testing** — unit-test workers/dispatchers with the `hoc-jest` skill.

## Detail files

- [job-triple.md](./references/job-triple.md) — Manifest / Worker / Dispatcher in full, body schema,
  lifecycle hooks, the return-value-in-Redis rule, base-app-dispatcher DRY, enqueue paths (§1)
- [engine-and-infra.md](./references/engine-and-infra.md) — Engine config, Share, Context,
  RedisConnection, package exports (§2)
- [daemon-and-scheduler.md](./references/daemon-and-scheduler.md) — `JobWorkersDaemon` (both boot
  paths), `scripts/*`, cron + interval schedulers, the scheduler service, pm2 (§3, §6)
- [subscriptions.md](./references/subscriptions.md) — progress publish/subscribe, channel + scope,
  AI-worker plumbing (§4)
- [queues.md](./references/queues.md) — splitting queues, shared-base placement, `skipJobHash`,
  per-queue tuning (§5)
