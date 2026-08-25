# Testing (agent-loop testing guidelines)

The testing approach for actions / loops / composition / Worker / Dispatcher / Resolver written with
`@openreachtech/mentsu-agent-loop-*`. Referenced from `SKILL.md`. The specs of the target classes are in
[core.md](./core.md) / [renchan-job-integration.md](./renchan-job-integration.md) /
[graphql-integration.md](./graphql-integration.md).

These follow the **`hc-jest` skill** — read it for the general rules; this file only
applies them to the agent-loop classes. In short: one file per class; nest
`describe(ClassName) > describe('#member()' / '.get:member') > describe('should …') > test.each(cases)`;
write each test as **Arrange / Act / Assert** separated by blank lines, taking the Act result into a
`received` variable; bind every `jest.fn()` to a `~Spy` variable; and keep `cases` data unique and
index-readable (`fake-keyword-0001`, `100001`, …).

## Grand principle: swap `context` for a stub and touch no real I/O

Because this library is deps:0 with `context` DI, **everything can be unit-tested without touching AI,
DB, Redis, or the network**. Tests always stub `context` and never hit external systems.

- **Why**: since the iteration logic reaches dependencies through `context` rather than importing them
  directly (the grand principle in `SKILL.md`), a test just fakes `context` and becomes fast and
  deterministic. Tests that touch real I/O are slow, flaky, and throw away this design's benefit.
- Test a Worker by **`new`-ing it directly** rather than going through the BullMQ factory (below). Do
  not start a daemon or Redis.

## The contract test kit (secure the baseline first)

The core `@openreachtech/mentsu-agent-loop-core/lib/testing/index.js` provides `LoopContractAssertion` /
`ActionContractAssertion`. Calling `create({ createInstance }).assert()` inside a jest test verifies the
base contract (inheritance, required getters, presence of abstract hooks, validity of QC values).

```js
import {
  LoopContractAssertion,
} from '@openreachtech/mentsu-agent-loop-core/lib/testing/index.js'

import ResearchAgentLoop from '../../app/agentLoops/ResearchAgentLoop.js'

describe('ResearchAgentLoop', () => {
  describe('loop contract', () => {
    test('should satisfy the base loop contract', () => {
      const assertion = LoopContractAssertion.create({
        createInstance: () => ResearchAgentLoop.create({
          context: {
            aiAgent: {},
            searchClient: {},
          },
        }),
      })

      const received = assertion.assert()

      expect(received)
        .toBeTruthy()
    })
  })
})
```

- What `LoopContractAssertion` checks: `instanceof BaseAgentLoop` / `maxIterations` is an integer ≥ 1 /
  `compressionInterval` is `null` or an integer ≥ 1 / `run`, `createInitialState`, `advanceState`,
  `isComplete`, `buildResult` are functions.
- What `ActionContractAssertion` checks: `instanceof BaseAgentAction` / `name` and `description` are
  non-empty strings / `run` is a function.
- **Why put the contract test first**: before testing individual logic, it catches base-contract
  violations (an unimplemented hook, an invalid `maxIterations`) in one line. The contract test is the
  **baseline**, not coverage. Test the logic separately.

## Unit-test approach per class

### Action (`BaseAgentAction`)

`Action.create()` and call `run({ argumentHash, context, onProgress })`, asserting that the **context
stub is called as expected and the return value is correct**, and that **`onProgress` fires**.

```js
describe('SearchAction', () => {
  describe('#run()', () => {
    describe('should search via the injected client', () => {
      const cases = [
        {
          tally: {
            keyword: 'fake-keyword-0001',
          },
        },
        {
          tally: {
            keyword: 'fake-keyword-0002',
          },
        },
      ]

      test.each(cases)('keyword: $tally.keyword', async ({ tally }) => {
        const searchSpy = jest.fn()
          .mockResolvedValue({
            items: [], // neutral; not under test
          })
        const args = {
          argumentHash: tally,
          context: {
            searchClient: {
              search: searchSpy,
            },
          },
          onProgress: jest.fn(),
        }

        await SearchAction.create()
          .run(args)

        expect(searchSpy)
          .toHaveBeenCalledWith(tally)
      })
    })

    describe('should resolve the search result', () => {
      const cases = [
        {
          input: {
            keyword: 'fake-keyword-0001',
          },
          expected: {
            items: [
              'fake-item-0001',
            ],
          },
        },
        {
          input: {
            keyword: 'fake-keyword-0002',
          },
          expected: {
            items: [
              'fake-item-0002',
            ],
          },
        },
      ]

      test.each(cases)('keyword: $input.keyword', async ({ input, expected }) => {
        const searchSpy = jest.fn()
          .mockResolvedValue(expected)
        const args = {
          argumentHash: {
            keyword: input.keyword,
          },
          context: {
            searchClient: {
              search: searchSpy,
            },
          },
          onProgress: jest.fn(),
        }

        const received = await SearchAction.create()
          .run(args)

        expect(received)
          .toEqual(expected)
      })
    })
  })
})
```

Verify `onProgress` fires with a third `describe('should emit progress')` of the same shape — bind
the callback to `onProgressSpy` and assert `.toHaveBeenCalled()`.

### Loop (`BaseAgentLoop` subclasses)

Look at it in two layers.

1. **The whole `run`**: with a fake `context`, call `run({ input, onProgress })` and assert the final
   result, the **stop (`isComplete` / `maxIterations`)**, and **progress firing**. In a separate case,
   confirm that even when the stop condition keeps returning false, it stops at `maxIterations` (the
   infinite-loop safety bound).
2. **Individual hooks**: call `createInitialState` / `isComplete` / `buildResult` (and `decideNext` /
   `reduceActionResult` for AI-driven, or `advanceState` for procedural) directly, and check the
   immutable state update and the branching.

```js
// maxIterations safety bound: stops even when isComplete is always false.
// Override via jest.spyOn (not a test-only subclass); test.each proves the bound
// reads maxIterations rather than a hardcoded number.
describe('ResearchAgentLoop', () => {
  describe('#run()', () => {
    describe('should stop at maxIterations when never complete', () => {
      const cases = [
        {
          override: {
            maxIterations: 2,
          },
          expected: 2,
        },
        {
          override: {
            maxIterations: 3,
          },
          expected: 3,
        },
      ]

      test.each(cases)('maxIterations: $override.maxIterations', async ({ override, expected }) => {
        jest.spyOn(ResearchAgentLoop.prototype, 'maxIterations', 'get')
          .mockReturnValue(override.maxIterations)
        jest.spyOn(ResearchAgentLoop.prototype, 'isComplete')
          .mockReturnValue(false) // never complete → forces the safety bound

        const loop = ResearchAgentLoop.create({
          context: {
            aiAgent: {},
            searchClient: {},
          },
        })
        const args = {
          input: {
            keyword: 'fake-keyword-0001',
          },
        }

        const result = await loop.run(args)
        const received = result.iterations

        expect(received)
          .toBe(expected)
      })
    })
  })
})
```

### Composition (`BaseAgentPipeline` / `BaseCompositeAgent` / `BaseActionStage`)

- **Pipeline**: that `get stageCtors` returns the expected stage list, and that `run` threads the payload
  across stages into the final `buildResult`. Stage Ctors may be stubs (fake Runnables with `create` /
  `run`).
- **Composite**: the split from `planSubTasks`, the combine in `mergeResults`, and the `concurrency`
  value.
- **ActionStage**: `static get ActionCtor` / `buildArgumentHash` (payload → arguments) / `buildOutput`
  (result → output).

### Worker (`BaseAgentJobWorker` subclasses)

**Do not** go through the BullMQ factory; fake the engine / broker and **`new` it directly** in each
test's Arrange. Do **not** extract a `createWorker()` helper into the test file — a helper defined in
the test file is unverified logic (see the `hc-jest` skill's anti-pattern); if the construction is
genuinely reused, put the builder under `tests/tools/` with its own test.

Behaviors to verify:

- **`buildOptionHash()`**: that `concurrency` / `limiter` from `config` are forwarded to the BullMQ
  options (needed because the base only passes `connection`).
- **`buildTopic({ scope })`**: `channel` when `scope` is `null`, otherwise `channel:key=value` (keys
  sorted ascending).
- **`onJobProgress` / `onJobCompleted` / `onJobFailed`**: that the broker's `publish` is called with the
  **correct channel and event shape** (completed is `{ phase: 'done', payload: result }`, failed is
  `{ phase: 'error', payload: { message } }`).
- **`executeJob({ body, context, parcel })`**: that the loop runs and returns a result, and progress
  flows to `parcel.jobModel.job.updateProgress`.
- **If you overrode `publishProgress`** (e.g. to match renchan's broker shape), verify that call shape
  too.

```js
describe('ResearchJobWorker', () => {
  describe('#executeJob()', () => {
    describe('should stream progress to the job', () => {
      const cases = [
        {
          input: {
            jobId: 100001,
          },
        },
        {
          input: {
            jobId: 100002,
          },
        },
      ]

      test.each(cases)('jobId: $input.jobId', async ({ input }) => {
        const worker = new ResearchJobWorker({
          engine: {
            subscriptionBroker: {
              publish: jest.fn(),
            },
          },
          config: {
            connection: {
              host: 'localhost',
              port: 6379,
            },
          },
          manifest: null,
          dispatcherHash: {},
          errorHash: {},
        })

        const updateProgressSpy = jest.fn()
        const args = {
          body: {
            jobId: input.jobId,
          },
          context: {},
          parcel: {
            jobModel: {
              job: {
                updateProgress: updateProgressSpy,
              },
            },
          },
        }

        await worker.executeJob(args)

        expect(updateProgressSpy)
          .toHaveBeenCalled()
      })
    })
  })
})
```

Verify the return value with a sibling `describe('should return a result')` — take
`const received = await worker.executeJob(args)` and assert `.toBeDefined()`.

### Dispatcher (`BaseAgentJobDispatcher` subclasses)

- That `static get EngineCtor` / `static get ManifestCtor` return the correct classes.
- That `dispatchAgentJob({ input })` delegates to `dispatchJob({ body: input, optionHash })` (stub
  `dispatchJob` and check the arguments; do not actually enqueue).

### Mutation resolver (`BaseRequestAgentMutationResolver` subclasses)

Pass a fake `context` whose `share` carries a stubbed dispatch provider, and verify that
`resolve({ variables, context })` **dispatches with the body from `buildJobBody`** and returns
**`{ accepted, jobId }`**. (This matches sourcing the dispatcher from `context.share`; see the note in
[graphql-integration.md](./graphql-integration.md).)

```js
describe('RequestResearchMutationResolver', () => {
  describe('#resolve()', () => {
    describe('should return acceptance with the dispatched job id', () => {
      const cases = [
        {
          input: {
            jobId: 100001,
          },
          expected: {
            accepted: true,
            jobId: 'fake-job-id-0001',
          },
        },
        {
          input: {
            jobId: 100002,
          },
          expected: {
            accepted: true,
            jobId: 'fake-job-id-0002',
          },
        },
      ]

      test.each(cases)('jobId: $input.jobId', async ({ input, expected }) => {
        const resolver = new RequestResearchMutationResolver({
          errorHash: {},
        })

        const dispatchJobSpy = jest.fn()
          .mockResolvedValue({
            hasResponse: () => true,
            idKey: expected.jobId,
          })
        const args = {
          variables: {
            input: {
              jobId: input.jobId,
            },
          },
          context: {
            share: {
              jobDispatcherProvider: {
                dispatchJob: dispatchJobSpy,
              },
            },
          },
        }

        const received = await resolver.resolve(args)

        expect(received)
          .toEqual(expected)
      })
    })
  })
})
```

Verify the dispatch itself with a sibling `describe('should dispatch the job body')` — assert
`dispatchJobSpy` was called with `{ DispatcherCtor: ResearchJobDispatcher, body: <buildJobBody> }`.

### Subscription resolver (`BaseAgentProgressSubscriptionResolver` subclasses) — always verify channel match

Verify that `generateChannel` / `buildTopic` produce **the same string as the `AgentTopic` the Worker
builds from**, by comparing against a hand-built `AgentTopic` expected value. This is the only guard
against publish/subscribe drift.

```js
import {
  AgentTopic,
} from '@openreachtech/mentsu-agent-loop-core'

describe('OnResearchProgressSubscriptionResolver', () => {
  describe('#generateChannel()', () => {
    describe('should match the channel the worker publishes to', () => {
      const cases = [
        {
          input: {
            query: {
              userId: 100001,
            },
          },
        },
        {
          input: {
            query: {
              userId: 100002,
            },
          },
        },
      ]

      test.each(cases)('userId: $input.query.userId', ({ input }) => {
        const resolver = new OnResearchProgressSubscriptionResolver({
          errorHash: {},
        })

        const expected = AgentTopic.create({
          channel: 'researchProgress', // the same channel the Worker builds from
          scope: input.query,
        })
          .value
        const args = {
          query: input.query,
        }

        const received = resolver.generateChannel(args)

        expect(received)
          .toBe(expected)
      })
    })
  })
})
```

- Also confirm that `generateChannelQuery({ variables })` returns the expected scope, and that
  `get channel()` is the same string as the Worker's.
- **Why compare against a hand-built `AgentTopic`**: even though the Worker and the Subscription are
  implemented independently, one test pins that both resolve to the same channel string. The moment
  `channel` or a scope key is changed on only one side, this test fails.

### Runner

- `InlineAgentRunner`: that `request({ input, onProgress })` runs the loop and returns the final result.
- `JobAgentRunner`: stub `DispatcherCtor.createAsync` / `dispatchJob` / `teardown`, and verify that
  `request({ input })` enqueues, returns `{ accepted, jobId }`, and calls `teardown`.

## Verifying unimplemented abstracts

Touching an abstract member of a base class throws `ConcreteMemberNotFoundError`. Assert this with
`expect(operation).toThrow(ConcreteMemberNotFoundError)` to guarantee **the subclass overrides it
correctly**.

```js
describe('BaseAgentJobWorker', () => {
  describe('.get:AgentLoopCtor', () => {
    describe('when not inherited', () => {
      test('should throw error', () => {
        const operation = () => BaseAgentJobWorker.AgentLoopCtor

        expect(operation)
          .toThrow(ConcreteMemberNotFoundError)
      })
    })
  })
})
```

- **Why**: with both the contract test (the kit) and individual tests, "forgot to implement" is detected
  at runtime rather than by types. This library has no true `final` and works around gaps via override,
  so the unimplemented is detected by a throw.
