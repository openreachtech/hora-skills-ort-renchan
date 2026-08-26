# The job triple (Manifest / Worker / Dispatcher)

The per-job files and how they fit together. Referenced from §1 of [SKILL.md](../SKILL.md). Examples
draw on both this repo (`app/jobs/**`) and the package's own `samples/confirm-01`.

## Directory layout

One job = one directory `app/jobs/<kebab-job-name>/` holding:

```
app/jobs/send-report-email/
├── SendReportEmailJobManifest.js    # queue name + body schema
├── SendReportEmailJobWorker.js      # consume: executeJob + hooks
├── SendReportEmailJobDispatcher.js  # produce: enqueue + queue options
└── .keepDirectory.js
```

- The directory name is kebab-case and **equals the `jobName`** (the BullMQ queue name).
- Classes are PascalCase with the fixed suffixes `JobManifest` / `JobWorker` / `JobDispatcher` (and
  `CronJobScheduler` / `IntervalJobScheduler` for scheduled jobs —
  [daemon-and-scheduler.md](./daemon-and-scheduler.md)).

## Manifest — queue name + body schema

`BaseJobManifest` subclass. `jobName` is the single source of truth for the queue name; `bodySchema`
validates the enqueue payload. Scalars come from `ScalarHash` (`Text` / `Integer` / …) of
`@openreachtech/mentsu-schema`.

```js
import { BaseJobManifest } from '@openreachtech/renchan-job-bullmq'
import { ScalarHash } from '@openreachtech/mentsu-schema'

const { Integer, Text } = ScalarHash

export default class ContentGenerationPublicLpJobManifest extends BaseJobManifest {
  /** @override */ static get jobName () { return 'content-generation-public-lp' }

  /** @override */
  static get bodySchema () {
    return {
      jobId: Integer,
      accessToken: Text,
    }
  }
}
```

- The body is normalized/denormalized by the framework for Redis transport, so it may carry rich
  values (e.g. `Date`, `BigNumber` — see `samples/confirm-01`'s alpha body), not just primitives.
  Keep the body **minimal** — usually just ids/tokens; load the full row from the DB in the worker.

## Worker — executeJob + lifecycle hooks

`BaseJobWorker` subclass. Point `ManifestCtor` at the Manifest and implement `executeJob`. The four
lifecycle hooks are **abstract** and must be implemented; use `this.timber` for console logging and
`this.ensureLogger()` for the per-job file logger.

```js
import { BaseJobWorker } from '@openreachtech/renchan-job-bullmq'
import AlphaJobManifest from './AlphaJobManifest.js'

export default class AlphaJobWorker extends BaseJobWorker {
  /** @override */ static get ManifestCtor () { return AlphaJobManifest }

  /** @override */
  async executeJob ({
    body,
    context,
    parcel,
  }) {
    this.timber.log(`[${this.Ctor.jobName}] started with body:`, body)

    // ... the work ...

    // WARNING: the return value is stored in Redis. Return only the minimum necessary —
    // never arrays of entities / large blobs (memory pressure + instability).
    return {
      executedAt: new Date().toISOString(),
    }
  }

  // Implement the four lifecycle hooks too (return null for a fire-and-forget job):
  //   onJobCompleted / onJobFailed / onJobProgress / onWorkerError
}
```

- **`executeJob({ body, context, parcel })`** — `body` is the validated, normalized payload;
  `context` is the per-job DI object (Context); `parcel` wraps the BullMQ job (`parcel.jobModel.job`
  for `updateProgress`, token, abort signal).
- **Return value is persisted in Redis** — keep it tiny.
- **`buildOptionHash()`** overrides BullMQ `WorkerOptions`; spread `super.buildOptionHash()` (which
  supplies `connection`) and add `concurrency` / `limiter`:

```js
/** @override */
buildOptionHash () {
  return {
    ...super.buildOptionHash(),

    concurrency: 5,
  }
}
```

- Lifecycle hooks fire per BullMQ event. For a fire-and-forget job, return `null` from each. To
  publish progress to a subscription, override `onJobProgress` (see
  [subscriptions.md](./subscriptions.md)).

## Dispatcher — enqueue + per-queue options

`BaseJobDispatcher` subclass. It needs `EngineCtor` (which Engine/Redis to use) and `ManifestCtor`.
`static optionHash` sets BullMQ `QueueOptions` (producer defaults such as `attempts`).

```js
import { BaseJobDispatcher } from '@openreachtech/renchan-job-bullmq'
import ContentGenerationJobEngine from '../../ContentGenerationJobEngine.js'
import SendReportEmailJobManifest from './SendReportEmailJobManifest.js'

export default class SendReportEmailJobDispatcher extends BaseJobDispatcher {
  /** @override */ static get EngineCtor () { return ContentGenerationJobEngine }
  /** @override */ static get ManifestCtor () { return SendReportEmailJobManifest }

  /** @override */
  static get optionHash () {
    return {
      defaultJobOptions: {
        attempts: 3,
      },
    }
  }
}
```

### DRY: a base app dispatcher

When several dispatchers share one Engine, define a base app dispatcher that sets `EngineCtor` once,
and let each job dispatcher set only `ManifestCtor` (this is what `samples/confirm-01` does):

```js
// SampleBaseAppJobDispatcher.js
export default class SampleBaseAppJobDispatcher extends BaseJobDispatcher {
  /** @override */ static get EngineCtor () { return SampleJobEngine }
}

// jobs/alpha/AlphaJobDispatcher.js
export default class AlphaJobDispatcher extends SampleBaseAppJobDispatcher {
  /** @override */ static get ManifestCtor () { return AlphaJobManifest }
}
```

## Enqueuing

**From a resolver** — use the request-scope `JobDispatcherProvider` (connection reuse; see
[engine-and-infra.md](./engine-and-infra.md)):

```js
await context.share.jobDispatcherProvider.dispatchJob({
  DispatcherCtor: SendReportEmailJobDispatcher,
  body: {
    sessionToken,
  },
})
```

**Standalone (one-off script)** — self-boot, dispatch, inspect the response, tear down:

```js
const dispatcher = await AlphaJobDispatcher.createAsync()

const response = await dispatcher.dispatchJob({
  body: {
    // ...
  },
})

if (response.hasError()) {
  // response.errorMessage
}
if (response.hasResponse()) {
  // response.createDispatchedAt()  → Date the job was enqueued
}

await dispatcher.teardown()
```

- `dispatchJob({ body })` validates `body` against the Manifest schema, `queue.add`s, and returns a
  **DispatcherResponse** (`hasError()` / `errorMessage` / `hasResponse()` / `createDispatchedAt()`).
  It auto-`teardown()`s the queue connection unless `keepsConnection: true` is passed (the provider
  passes `true` to reuse the connection).
