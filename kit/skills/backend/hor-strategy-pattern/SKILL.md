---
name: hor-strategy-pattern
description: >
  Implement the strategy pattern as a trio of a base processor class, one concrete subclass per
  variant, and a bulk loader that auto-discovers the subclasses from a directory and picks one by
  a dispatch getter. Use this skill whenever the user asks to replace an else-if / switch chain
  that dispatches on a "type" string with pluggable processor classes, or to add a new event /
  webhook / message handler that must be auto-discovered.
---

# Strategy Pattern (processor classes + a bulk loader)

A skill for dispatching on a string "type" value to one of several behaviors **without an
`else if` / `switch` chain**. Each branch becomes a class; a loader auto-discovers the classes
from a directory and picks one by a dispatch **getter**. The class skeleton each piece follows
(one file / one class, `static create()` factory, JSDoc typedefs) comes from `class-design` —
this skill covers how the three pieces fit together.

Reach for it when:

- You would otherwise write `if (type === 'a') ... else if (type === 'b') ...`.
- New variants get added over time and you want to drop a file in a folder, not edit a switch.
- Each branch has non-trivial logic worth testing in isolation.

Do **not** reach for it for a 2-branch boolean or a value map with no behavior — a plain
lookup hash is enough there.

## Grand principle: adding a variant means adding a file, never editing a dispatch chain

Every rule in this skill serves one point: **the set of variants is discovered from the
filesystem, not listed in code**. A new variant is one new subclass file dropped into the
processor directory; no existing file changes.

- **Why not a switch**: an `else if` / `switch` chain concentrates every variant's wiring in one
  function, so every new variant edits (and risks breaking) shared code, and each branch's logic
  can't be tested in isolation. One-class-per-variant keeps each branch independently testable
  and reviewable.
- **Why auto-discovery**: if the loader imported each subclass by name, the "chain" would just
  move into the import list. Loading every class in the directory
  ([4](#4-bulk-loader-auto-discover-and-pick-by-getter)) makes the directory itself the
  registry.
- **Why dispatch by getter**: the key a processor handles is part of that processor's contract,
  so it lives **on the subclass** as an overridden getter — not in a name field passed from
  outside, and not in a mapping table kept next to the loader.

```js
// Good: the caller asks the loader; variants stay out of the call site
const processor = loader.resolveProcessor(eventCategory)

if (!processor) {
  return null
}

return processor.process({
  event,
})
```

```js
// Avoid: an else-if chain enumerating every variant at the call site
//   → every new variant edits this shared function; branches can't be tested in isolation
if (eventCategory === 'created') {
  return handleCreated(event)
} else if (eventCategory === 'updated') {
  return handleUpdated(event)
} else if (eventCategory === 'deleted') {
  return handleDeleted(event)
}
```

## Comment language in the sample code

Comments in the `js` examples in this SKILL.md follow the prose language (here, **English**),
because the examples are *explanation* of the skill. Comments inside the **artifact this skill
produces** (the real processor / loader code) follow the **codebase** language — English — to
match the surrounding source.

## 1. The three pieces

| Piece | Role | Count |
| --- | --- | --- |
| Base class | Declares the `static create()` factory, the abstract dispatch **getter** (throws until overridden), and the abstract work method (throws until overridden) | 1 |
| Concrete subclasses | One file per variant; each overrides the dispatch getter to return its key and overrides the work method | 1 per variant |
| Bulk loader | `static async createAsync()` loads every class in the processor directory via `DeepBulkClassLoader`, instantiates each; `resolveProcessor(key)` finds the one whose dispatch getter matches, `?? null` | 1 |

Typical layout (a payment-gateway webhook example):

```
app/tools/eventProcessors/
├── BaseEventProcessor.js
├── concretes/
│   ├── CreateEventProcessor.js
│   ├── UpdateEventProcessor.js
│   └── DeleteEventProcessor.js
app/tools/bulkLoaders/
└── BulkEventProcessorsLoader.js
```

## 2. Base class: an abstract getter + an abstract work method

Dispatch is **by getter**, not by a `processorName` field or a `static getName()`. The getter
throws until a subclass overrides it. `static create()` is the factory; the work method is
abstract and also throws. Throwing abstract members are the whole "interface" — there is no
TypeScript interface to implement.

```js
/**
 * Base class for event processors.
 */
export default class BaseEventProcessor {
  /**
   * Factory method.
   *
   * @template {X extends typeof BaseEventProcessor ? X : never} T, X
   * @param {BaseEventProcessorFactoryParams} params - Parameters for the factory.
   * @returns {InstanceType<T>} An instance of the class.
   * @this {T}
   */
  static create (params) {
    return /** @type {InstanceType<T>} */ (
      new this(params)
    )
  }

  /**
   * get: Dispatch key this processor handles.
   *
   * @abstract
   * @returns {string}
   * @throws {Error} - When not overridden in a subclass.
   */
  get eventCategory () {
    throw new Error('eventCategory must be implemented in subclass')
  }

  /**
   * Process the event.
   *
   * @abstract
   * @param {EventProcessorParams} params - Parameters for processing.
   * @returns {Promise<*>}
   * @throws {Error} - When not overridden in a subclass.
   */
  async process ({
    event,
  }) {
    throw new Error('process must be implemented in subclass')
  }
}

/**
 * @typedef {object} EventProcessorParams
 * @property {*} event - The event to process.
 */

/**
 * @typedef {{
 *   [key: string]: *
 * }} BaseEventProcessorFactoryParams
 */
```

- When a processor needs collaborators, take them as constructor deps and default them in
  `create()` (e.g. `static create ({ randomTextGenerator = this.createRandomTextGenerator() } = {})`),
  following `class-design`. Keep that shape rather than `new`-ing collaborators inside the work
  method.

## 3. Concrete subclass: one file per variant

Override the dispatch getter (mark it `@override`) to return the key **from a shared constant
hash, not a bare string literal**, and override the work method. `static create()` is inherited
from the base — subclasses only redefine it when they need extra defaults.

```js
import BaseEventProcessor from '../BaseEventProcessor.js'

import CONSTANT from '../../../globals/constants.js'

const {
  EVENT_TYPE,
} = CONSTANT

/**
 * Event processor: handle "create" events.
 */
export default class CreateEventProcessor extends BaseEventProcessor {
  /**
   * get: Dispatch key this processor handles.
   *
   * @override
   * @returns {string}
   */
  get eventCategory () {
    return EVENT_TYPE.CREATE_RECORD
  }

  /**
   * Process the event.
   *
   * @override
   * @param {{
   *   event: *
   * }} params - Parameters for processing.
   * @returns {Promise<*>}
   */
  async process ({
    event,
  }) {
    return this.buildResult({
      event,
    })
  }
}
```

- **Why a constant hash for the key**: the same key string appears on the producer side (the
  webhook / message payload) and the consumer side (the getter). A shared constant makes a typo
  a reference error instead of a silent dispatch miss.
- Suffix concrete classes by role (`~Processor`, `~Handler`, `~Converter`), aligned with the
  base class name.

## 4. Bulk loader: auto-discover and pick by getter

The loader resolves the processor directory with `rootPath.to(...)`, loads every class in it via
`DeepBulkClassLoader.create({ poolPath }).loadClasses()`, and instantiates each with
`.create()`. `resolveProcessor(key)` matches on the dispatch getter and returns **`?? null`** on a
miss — there is no default / fallback processor and no throw inside the loader.

```js
import {
  DeepBulkClassLoader,
} from '@openreachtech/renchan'

import {
  rootPath,
} from '../../globals/_.js'

const eventProcessorPath = rootPath.to('app/tools/eventProcessors/concretes')

/**
 * Bulk loader for event processors.
 */
export default class BulkEventProcessorsLoader {
  /**
   * Constructor.
   *
   * @constructor
   * @param {BulkEventProcessorsLoaderConstructorParams} params - Parameters of this constructor.
   */
  constructor ({
    processors,
  }) {
    this.processors = processors
  }

  /**
   * Factory method as async.
   *
   * @param {string} [path] - The path to load processors from.
   * @returns {Promise<BulkEventProcessorsLoader>}
   */
  static async createAsync (path = eventProcessorPath) {
    const processorClasses = await this.loadProcessorClasses(path)

    const processors = processorClasses.map(ProcessorClass =>
      ProcessorClass.create()
    )

    return new this({
      processors,
    })
  }

  /**
   * Factory method.
   *
   * @template {X extends typeof BulkEventProcessorsLoader ? X : never} T, X
   * @param {BulkEventProcessorsLoaderFactoryParams} params - Parameters for the factory.
   * @returns {InstanceType<T>} An instance of the class.
   * @this {T}
   */
  static create (params) {
    return /** @type {InstanceType<T>} */ (
      new this(params)
    )
  }

  /**
   * Load processor classes from the specified path.
   *
   * @param {string} path - The path to load processor classes from.
   * @returns {Promise<Array<typeof import('../eventProcessors/BaseEventProcessor.js').default>>}
   */
  static async loadProcessorClasses (path) {
    return /** @type {*} */ (
      DeepBulkClassLoader.create({
        poolPath: path,
      })
        .loadClasses()
    )
  }

  /**
   * Resolve a processor by dispatch key.
   *
   * @param {string} eventCategory - The dispatch key.
   * @returns {import('../eventProcessors/BaseEventProcessor.js').default | null}
   */
  resolveProcessor (eventCategory) {
    return this.processors.find(processor => processor.eventCategory === eventCategory)
      ?? null
  }
}

/**
 * @typedef {object} BulkEventProcessorsLoaderConstructorParams
 * @property {Array<import('../eventProcessors/BaseEventProcessor.js').default>} processors - The event processors.
 */

/**
 * @typedef {{
 *   processors: Array<import('../eventProcessors/BaseEventProcessor.js').default>
 * }} BulkEventProcessorsLoaderFactoryParams
 */
```

- **Why `?? null` and no fallback processor**: what a miss means (skip? log? error response?)
  is the caller's decision, and it differs per call site. A `'default_processor'` chain inside
  the loader hides unknown keys from the caller.
- Build the loader once (at startup / in a shared instance) and reuse it — `createAsync()` reads
  the filesystem, so don't re-run it per event.

## 5. Caller side

The caller asks the loader for a processor and decides what a `null` means:

```js
const loader = await BulkEventProcessorsLoader.createAsync()

const processor = loader.resolveProcessor(eventCategory)

if (!processor) {
  return null
}

return processor.process({
  event,
})
```

## 6. Testing

Following the `hoc-jest` skill, split files per class.

- **Base class**: each abstract member throws (`eventCategory`, the work method); `static create()`
  returns an instance of the called class.
- **Each concrete subclass**: inheritance (extends the base); the dispatch getter returns the
  expected constant; the work method's behavior with `test.each()` over its variable inputs.
- **Bulk loader**: `resolveProcessor()` returns the matching processor for each known key
  (`test.each()` over the keys), and **`null` for an unknown key** — don't skip the miss case.

## Finishing checklist

- [ ] Did the change add a variant as **one new subclass file**, without editing a dispatch chain or an import list?
- [ ] Is dispatch a **getter** overridden per subclass (no `processorName` field, no `static getName()`)?
- [ ] Do the abstract base members throw `new Error('... must be implemented in subclass')`?
- [ ] Does the dispatch getter return its key from a **shared constant hash**, not a bare string literal?
- [ ] Does the loader auto-discover via `DeepBulkClassLoader` from a `rootPath.to(...)` directory, and does `resolveProcessor()` return `?? null` on a miss (no fallback processor, no throw)?
- [ ] Is `static create()` the factory everywhere, with constructor deps defaulted in `create()` when needed (per `class-design`)?
- [ ] One class per file, suffixed by role (`~Processor`, `~Handler`, `~Converter`)?
- [ ] Do tests cover the abstract throws, each subclass's getter + behavior, and the loader's known-key / unknown-key cases?
