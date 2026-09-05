# The worker Daemon and the schedulers

Entry points: the worker Daemon (consumer) and the cron/interval scheduler registration. Referenced
from §3 and §6 of [SKILL.md](../SKILL.md). Draws on this repo's `scripts/` and the package's
`samples/confirm-01` (daemon) and `samples/confirm-02` (cron + interval schedulers).

## Worker Daemon

`JobWorkersDaemon` boots every `BaseJobWorker` subclass found under the engine's `workersPath`
(`DeepBulkClassLoader` scans recursively; a new job directory is picked up with no registration),
binds each to its Manifest's `jobName`, and installs SIGINT/SIGTERM graceful shutdown.

### Path A — simple (`createAsync`), no progress broker

The minimal form (the package `samples/confirm-01` shows this shape) is `createAsync` →
`startDaemon`:

```js
import { JobWorkersDaemon } from '@openreachtech/renchan-job-bullmq'
import SampleJobEngine from '../app/SampleJobEngine.js'

// createAsync builds the engine and auto-discovers every BaseJobWorker under workersPath
const daemon = await JobWorkersDaemon.createAsync({
  EngineCtor: SampleJobEngine,
})

await daemon.startDaemon()
```

### Path B — with a progress broker (this repo)

When workers publish progress to a subscription, build the broker first and inject it into the
Engine, then create the daemon from that engine
(`scripts/startJobDaemon.js`):

```js
import { SubscriptionBroker } from '@openreachtech/renchan'
import { JobWorkersDaemon } from '@openreachtech/renchan-job-bullmq'
import activate from '../sequelize/_.js'
import ContentGenerationJobEngine from '../app/ContentGenerationJobEngine.js'
import RedisConnection from '../app/queue/RedisConnection.js'

await activate() // Sequelize (workers touch the DB)

const subscriptionBroker = SubscriptionBroker.create({
  config: {
    redisOptions: RedisConnection.create().generatePubSubOptions(),
  },
})

const engine = await ContentGenerationJobEngine.createAsync({
  subscriptionBroker,
})

const workerCtors = await JobWorkersDaemon.loadWorkerCtors({
  engine,
})

await JobWorkersDaemon
  .create({
    engine,
    WorkerCtors: workerCtors,
  })
  .startDaemon()
```

- `startDaemon()` returns the started workers; it `setupWorker()`s each (creates the BullMQ `Worker`,
  waits until ready, attaches the event sink) and attaches SIGINT/SIGTERM handlers that
  `teardownWorker()` all workers (graceful `worker.close()`).
- Use **Path B** whenever a worker publishes progress; **Path A** otherwise.

## Cron and interval schedulers

A scheduler registers a **repeatable job** into Redis (via `queue.upsertJobScheduler`). There are two
concrete bases (both exported from the package):

| Base class | Schedule value object | `schedule` shape in `collectScheduleInputs` |
| --- | --- | --- |
| `BaseCronJobScheduler` | `CronSchedule` | `{ cronExpression: '* * * * *' }` |
| `BaseIntervalJobScheduler` | `IntervalSchedule` | `{ millisecond: 10000, isImmediately: true }` |

A scheduler class declares `EngineCtor`, `ManifestCtor`, and `schedulerId`:

```js
import { BaseIntervalJobScheduler } from '@openreachtech/renchan-job-bullmq'
import SampleJobEngine from '../../SampleJobEngine.js'
import GammaJobManifest from './GammaJobManifest.js'

export default class GammaIntervalJobScheduler extends BaseIntervalJobScheduler {
  /** @override */ static get EngineCtor () { return SampleJobEngine }
  /** @override */ static get ManifestCtor () { return GammaJobManifest }
  /** @override */ static get schedulerId () { return 'gamma-interval-scheduler' }
}
```

(Cron looks identical with `BaseCronJobScheduler`; see
`purge-expired-content-sessions`.) The
**Worker** for a scheduled job is a normal `BaseJobWorker` — the schedule only controls *when* a job
is enqueued.

### The scheduler service — one place listing every schedule

A `BaseJobSchedulerService` subclass returns the schedule inputs. **Each `schedulerId` must match its
scheduler class's `schedulerId`.**

```js
import { BaseJobSchedulerService } from '@openreachtech/renchan-job-bullmq'

export default class SampleJobSchedulerService extends BaseJobSchedulerService {
  /** @override */
  static async collectScheduleInputs () {
    return [
      {
        schedulerId: 'beta-cron-scheduler',
        schedule: {
          cronExpression: '* * * * *',
        },
        body: {
          taskId: 1001,
          message: 'cron heartbeat',
        },
        optionHash: {},
      },
      {
        schedulerId: 'gamma-interval-scheduler',
        schedule: {
          millisecond: 10000,
          isImmediately: true,
        },
        body: {
          batchId: 2001,
          label: 'interval ping',
        },
        optionHash: {},
      },
    ]
  }
}
```

### Start / stop registration scripts (one-shot)

Registration is a **one-shot** script — it writes the repeatable-job definitions to Redis and exits;
the Daemon (separate, long-running process) consumes them.

```js
// start-schedule.js — register every repeatable job, then exit (one-shot)
const service = await ContentGenerationJobSchedulerService.createAsync({
  EngineCtor: ContentGenerationJobEngine,
})

await service.startAllSchedulers()

process.exit(0)
```

```js
// stop-schedule.js — remove every schedule, then exit
// (does NOT stop the Daemon; it only stops generating new jobs)
const service = await ContentGenerationJobSchedulerService.createAsync({
  EngineCtor: ContentGenerationJobEngine,
})

await service.stopAllSchedulers()

process.exit(0)
```

- Await the call and exit — this is the module's intended shape, matching this repo's
  `start-schedule.js`.
  `ContentGenerationJobSchedulerService.js`
  registers the hourly purge cron.
- Both calls return an array of response objects for optional inspection (start: `hasError()` /
  `hasResponse()` / `jobName` / `createDispatchedAt()`; stop: `hasError()` / `schedulerId` /
  `removed`). If you iterate them, use `for...of` / `map` / `filter` — **`forEach` is disallowed by
  our eslint.**

## pm2 processes

`pm2.config.cjs` runs the two long-lived processes: **`GraphQL API`**
(`server/index.js`, the producer) and **`Job Daemon`** (`scripts/startJobDaemon.js`, the
consumer). Schedule registration is run on demand, not as a pm2 app.
