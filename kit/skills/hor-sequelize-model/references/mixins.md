# Mixins (kinds of MixinModel and how to pass them)

Conventions for the MixinModels that compose routine behavior onto `RenchanModel`. Referenced
from `SKILL.md`. For how a Mixin injects features into the extension points (why `super.xxx?.()`
is kept) see
[default-methods.md](./default-methods.md#even-unused-extension-points-call-super-and-keep-a-noop).

## Pass mixins as an array from the Mixins getter

To make Mixins take effect on a model, **override `static get Mixins ()` to return an array of
MixinModels**. Import Mixins from `@openreachtech/renchan-sequelize`. You can pass several.

- **Why**: at each of the `associate` / `defineScopes` / `defineSubqueries` / `setupHooks`
  extension points, `RenchanModel` walks `Mixins` and composes the Mixin's same-named handler
  (`mixinsApplier`). That is why **routine behavior is declared as a Mixin rather than
  hand-written in the model** — "clone to a history table on every save", "include the latest
  status on find", and the like. Keeping `super.xxx?.()` first in the six methods is what makes
  this composition work
  ([default-methods.md](./default-methods.md#even-unused-extension-points-call-super-and-keep-a-noop)).
- The `Mixins` getter, and the abstract getters a Mixin requires (next section), go **after the
  six methods** (at the end). The "extensions added to this model" then sit together after the
  skeleton
  ([SKILL.md](../SKILL.md#grand-principle-a-model-is-a-filled-in-template-not-free-form-code)).

```js
// Good example (Mixins goes after the six methods)
import {
  BackupMixinModel,
  ModelAttributeFactory,
} from '@openreachtech/renchan-sequelize'

import BaseAppRenchanModel from '../baseModel/BaseAppRenchanModel.js'

export default class CustomerOrder extends BaseAppRenchanModel {
  // ... createAttributes through setupHooks (the six methods)

  /**
   * get: Mixin models to apply
   *
   * @returns {Array<Function>} Mixin models
   */
  static get Mixins () {
    return [
      BackupMixinModel,
    ]
  }

  // ↓ the abstract getter the Mixin requires (next section)
}
```

## Implement the abstract getter a mixin requires to pass it

Each Mixin declares "which model it relates to" and "which column it orders by" via an **abstract
getter** that `throw`s on the base. Overriding that getter on the model side to inject the
concrete value is how you **pass input** to the Mixin.

- **Why**: a Mixin is a reusable frame and does not know the model-specific counterpart (backup
  target, status table, etc.). If you do not implement the abstract getter, the moment that
  Mixin's handler runs it fails with `".get:XxxModel" must be inherited`. Which getter to pass
  is fixed per Mixin (table below).
- Return the related model with **`this._.<ModelName>`**, same as
  [associations.md](./associations.md#reference-the-associated-model-via-this_modelname) (to avoid
  a circular import).

```js
// Good example (implement BackupModel required by BackupMixinModel = pass the backup target)
/**
 * get: Backup model for BackupMixinModel
 *
 * @returns {typeof import('./CustomerOrdersBk')} Backup model declaration
 */
static get BackupModel () {
  return this._.CustomerOrdersBk
}
```

```js
// Bad example (passed to Mixins but the abstract getter is unimplemented — throws on save)
static get Mixins () {
  return [
    BackupMixinModel,
  ]
}
// no BackupModel getter → afterSave: ".get:BackupModel" must be inherited
```

## Mixin catalog (kinds and required abstract getters)

`index.js` exports six MixinModels. `BaseMixinModel` is the base of all Mixins and is never passed
directly; implement the abstract getters below and pass a Mixin to `Mixins` when a use arises.

| Mixin | Purpose | Required abstract getter | Optional override (default) |
| --- | --- | --- | --- |
| `BackupMixinModel` | clone/append business attributes to another table on every save (history) | `BackupModel` | — |
| `LatestStatusMixinModel` | keep a status history; auto-include on find and get the latest | `StatusModel` / `StatusPhaseModel` | `orderAttributeOfStatusPhaseModel` (`'savedAt'`) |
| `SuiteVersionMixinModel` | fetch a versioned "suite" per version | `SuiteModel` | `versionKey` (`'startedAt'`) / `getSuiteSorter` |
| `PaginationMixinModel` | provide `findAllWithPagination()` and a paging scope | none | — |
| `ReferralMixinModel` | referral tree via invite codes (Fertile Forest) | `InviteCodeModel` / `ReferralNodeModel` | `inviteCodeAttributeOfInviteCodeModel` and others |
| `AttributesLinearizerMixinModel` | flatten an included nested structure into each node's `dataValues` | none | — |

## How to pass each mixin

### BackupMixinModel (in use)

In the `afterSave` hook it `build`s → `save`s the body's business attributes (all attributes
except `id` / `createdAt` / `updatedAt` / `deletedAt`; the same exclusion as
[timestamps.md](./timestamps.md)) into the `BackupModel` table, appending a generation. **Pass it
to the body table (`CustomerOrder`), and `BackupModel` returns the backup table
(`CustomerOrdersBk`)**.

```js
// Good example (body table CustomerOrder; cloned to CustomerOrdersBk on every save)
export default class CustomerOrder extends BaseAppRenchanModel {
  // ... the six methods (e.g. this.belongsTo(this._.Customer) in associate)

  /**
   * get: Mixin models to apply
   *
   * @returns {Array<Function>} Mixin models
   */
  static get Mixins () {
    return [
      BackupMixinModel,
    ]
  }

  /**
   * get: Backup model for BackupMixinModel
   *
   * @returns {typeof import('./CustomerOrdersBk')} Backup model declaration
   */
  static get BackupModel () {
    return this._.CustomerOrdersBk
  }
}
```

- The backup table (`CustomerOrdersBk`) side is an ordinary model holding the body's business
  attributes plus a save time (`savedAt`). Because its name clashes with the pluralized inference
  of the class name, it declares `tableName`
  ([default-methods.md](./default-methods.md#when-to-add-tablename)).

### LatestStatusMixinModel

Relates a status table via `belongsToMany(StatusModel, { through: StatusPhaseModel })`,
auto-includes it in `beforeFind`, and returns the latest (head of `savedAt` descending) from the
instance's `latestStatus`. To change the ordering column, override
`orderAttributeOfStatusPhaseModel`.

```js
// How to pass (pass StatusModel / StatusPhaseModel to the body table)
static get Mixins () {
  return [
    LatestStatusMixinModel,
  ]
}

static get StatusModel () {
  return this._.OrderStatus
}

static get StatusPhaseModel () {
  return this._.OrderStatusPhase
}
```

### SuiteVersionMixinModel

Manages the `hasMany(SuiteModel)` "suite" by version and provides `findCurrentSuite()` /
`findAllSuites()` / `createWithSuite()`. The version basis column is `versionKey` (default
`'startedAt'`), pulling the latest version at or before that point. Override `getSuiteSorter` to
change the ordering.

```js
// How to pass (pass SuiteModel; override versionKey to change it)
static get Mixins () {
  return [
    SuiteVersionMixinModel,
  ]
}

static get SuiteModel () {
  return this._.PriceTableRow
}

static get versionKey () {
  return 'effectiveAt' // when overriding the default 'startedAt'
}
```

### PaginationMixinModel

Adds `findAllWithPagination({ pagination, options })` and a `&pagination` scope. It builds
`findOptions` from a `RequestPagination` and returns a `ResponsePagination` with the records. **No
abstract getter needed** (just pass it in the array).

```js
// How to pass (just pass it; no extra getter needed)
static get Mixins () {
  return [
    PaginationMixinModel,
  ]
}
```

### ReferralMixinModel

Handles a referral tree by invite code. Provides `createByInviteCode()` / `buildByInviteCode()`,
resolves the parent node from the invite code in `beforeCreate`, and `sprout`s a Fertile Forest
node in `afterCreate`. Pass `InviteCodeModel` (the invite-code table) and `ReferralNodeModel` (the
tree node).

- The tree-node model returned by `ReferralNodeModel` extends `FertileForestModel` (the exception
  in [notation.md](./notation.md#extend-baseapprenchanmodel-and-default-export)).

```js
// How to pass (pass the invite-code table and the node table)
static get Mixins () {
  return [
    ReferralMixinModel,
  ]
}

static get InviteCodeModel () {
  return this._.CustomerInviteCode
}

static get ReferralNodeModel () {
  return this._.CustomerReferralNode // a node table extending FertileForestModel
}
```

### AttributesLinearizerMixinModel

An instance mixin that **flattens** the nested structure read via include (the nested `entity`)
into an array on each node's `dataValues`. Use it when you want to treat a record with relations
as raw values at each level. **No abstract getter needed**.

```js
// How to pass (just pass it)
static get Mixins () {
  return [
    AttributesLinearizerMixinModel,
  ]
}
```
