# Default Methods (the six override methods and createOptions)

The template for the static methods that form a model's skeleton. Rooted in the
[grand principle](../SKILL.md#grand-principle-a-model-is-a-filled-in-template-not-free-form-code)
in `SKILL.md` (keep the extension points, leave a noop rather than deleting). For the contents of
the attributes see [notation.md](./notation.md); for the details of `associate()` see
[associations.md](./associations.md).

## Lay out the six methods in a fixed order, each with JSDoc

Every model defines the following six methods **in this order**, with a **JSDoc block** stating
the purpose, arguments, and return value immediately above each. Do not delete unused methods;
keep them with the template (below).

1. `createAttributes (DataTypes)`
2. `createOptions (sequelizeClient)`
3. `associate ()`
4. `defineScopes (Op)`
5. `defineSubqueries ()`
6. `setupHooks ()`

- **Why**: fixing the order across every model puts the same responsibility in the same position
  in every file. The reader never has to hunt for "where does this model wire relations, where
  does it add a scope". A JSDoc that records the purpose, `@param`, and `@returns` on each method
  makes each extension point's responsibility readable even in a declaration-only layer, and the
  `@param` type annotation prevents mixing up `DataTypes` / `Op` / `sequelizeClient`.
- `createAttributes` is **abstract** — the base `throw`s. Always implement it (if unimplemented,
  it fails in `initWithSequelizeClient`). The other five have a default implementation on the
  base; overriding them is for "adding this model's own declarations".

```js
// Good example (the skeleton; unused extension points are kept as noop)
export default class CustomerOrder extends BaseAppRenchanModel {
  /**
   * Define model attributes
   *
   * @param {import('sequelize').DataTypes} DataTypes - Sequelize DataTypes
   * @returns {object} Model attributes
   */
  static createAttributes (DataTypes) {
    const factory = ModelAttributeFactory.create(DataTypes)

    return {
      ...factory.ID_BIGINT,
      // ... attributes (notation.md)
    }
  }

  /**
   * Define model options
   *
   * @param {import('sequelize').Sequelize} sequelizeClient - Sequelize instance
   * @returns {object} Model options
   */
  static createOptions (sequelizeClient) {
    return {
      ...super.createOptions(sequelizeClient),
    }
  }

  /**
   * Define model associations
   */
  static associate () {
    super.associate?.()

    this.belongsTo(this._.Customer)
  }

  /**
   * Define model scopes
   *
   * @param {import('sequelize').Op} Op - Sequelize operators
   */
  static defineScopes (Op) {
    super.defineScopes?.(Op)

    // noop
  }

  /**
   * Define subqueries
   */
  static defineSubqueries () {
    super.defineSubqueries?.()

    // noop
  }

  /**
   * Setup model hooks
   */
  static setupHooks () {
    super.setupHooks?.()

    // noop
  }
}
```

## Even unused extension points call super and keep a noop

`associate` / `defineScopes` / `defineSubqueries` / `setupHooks` are **not deleted** even when
this model adds nothing to them. Reduce the body to two lines: `super.xxx?.()` (an optional call)
plus `// noop`.

- **Why**: per the
  [grand principle](../SKILL.md#grand-principle-a-model-is-a-filled-in-template-not-free-form-code),
  to avoid mistaking *a gap* for *not-applicable*. A noop reads as "no relation / no scope — and
  that was considered". Putting `super.xxx?.()` first is so a Mixin ([mixins.md](./mixins.md))
  does not get its base-defined behavior (Backup's `afterSave`, etc.) **swallowed** — each method
  on `RenchanModel` calls the Mixin's same-named handler via `mixinsApplier`, so if the override
  does not call `super`, the Mixin is disabled.
- Calling with `?.` (optional) is so it passes safely even when the base has no such method.

```js
// Good example (a defineScopes with nothing to add)
/**
 * Define model scopes
 *
 * @param {import('sequelize').Op} Op - Sequelize operators
 */
static defineScopes (Op) {
  super.defineScopes?.(Op)

  // noop
}
```

```js
// Bad example 1 (deleting the whole method — can't tell not-applicable from forgotten)
// defineScopes is not written

// Bad example 2 (not calling super — swallows the Mixin's scope / hook)
/**
 * Setup model hooks
 */
static setupHooks () {
  // noop (without super.setupHooks?.(), Backup's afterSave etc. won't run)
}
```

## createOptions spreads super.createOptions() and adds only extras

`createOptions()` **spreads `...super.createOptions(sequelizeClient)`** and adds only this model's
own options. The base `RenchanModel` returns
`{ modelName, sequelize, syncOnAssociation:false, timestamps:true, underscored:true }` as defaults.

- **Why**: `timestamps:true` ([timestamps.md](./timestamps.md)) and `underscored:true` (mapping
  camelCase attributes → snake columns;
  [SKILL.md](../SKILL.md#keep-a-one-to-one-correspondence-with-the-migration)) are shared
  assumptions for every model. Do not rewrite them per model; use the base defaults. The two
  below are the typical additions.
- If you add nothing else, finish in the three lines of the spread alone (most models do this).

```js
// Good example (adds nothing)
/**
 * Define model options
 *
 * @param {import('sequelize').Sequelize} sequelizeClient - Sequelize instance
 * @returns {object} Model options
 */
static createOptions (sequelizeClient) {
  return {
    ...super.createOptions(sequelizeClient),
  }
}
```

### When to add tableName

Add an explicit `tableName` only for a table that differs from the "physical name = plural /
model name = singular" rule. A backup table (`*Bk`) is the typical case.

- **Why**: normally Sequelize infers the (plural) table name from the (singular) model name, so no
  `tableName` is needed. But a backup table is named **`<original table name>_bk`** (original
  table `customer_orders` → `customer_orders_bk`), so its tail is `_bk` (singular), differing from
  the rule. Sequelize would infer `customer_orders_bks` from the model `CustomerOrdersBk`, which
  clashes with the real table `customer_orders_bk`. Left alone it queries a nonexistent table, so
  declare `tableName`. Conversely, do not write it for a model whose inference is already correct
  (`CustomerOrder → customer_orders`); that is redundant.

```js
// Good example (Bk table; inferred customer_orders_bks ≠ real customer_orders_bk)
/**
 * Define model options
 *
 * @param {import('sequelize').Sequelize} sequelizeClient - Sequelize instance
 * @returns {object} Model options
 */
static createOptions (sequelizeClient) {
  return {
    ...super.createOptions(sequelizeClient),

    tableName: 'customer_orders_bk',
  }
}
```

### When to add paranoid

Add `paranoid: true` only for a table that uses `deleted_at` soft delete.

- **Why**: with `paranoid` on, Sequelize stamps `deleted_at` on delete and excludes such rows
  from default finds. This works together with the migration creating a `deleted_at` column via
  `...factory.TIMESTAMPS_WITH_DELETED_AT` (`hor-sequelize-migration`). Adding `paranoid` without
  the column makes queries fail.

```js
// Good example (a join table that soft-deletes)
/**
 * Define model options
 *
 * @param {import('sequelize').Sequelize} sequelizeClient - Sequelize instance
 * @returns {object} Model options
 */
static createOptions (sequelizeClient) {
  return {
    ...super.createOptions(sequelizeClient),

    paranoid: true, // for deleted_at column
  }
}
```

## defineScopes / defineSubqueries / setupHooks are framework extension points

Understand the role of these three extension points (when you use them, add to them while keeping
`super.xxx?.()` first).

| Method | What it is for | API used |
| --- | --- | --- |
| `defineScopes(Op)` | add named scopes (reusable units of filtering / ordering) | `this.addScope(name, options)` |
| `defineSubqueries()` | register correlated subqueries by name so `this.subquery(name, ...)` can use them | `this.addSubquery({ name, generator })` |
| `setupHooks()` | add lifecycle hooks (before/after save and find) | `this.beforeFind` / `this.afterSave` / `this.addHook(...)` |

- The routine behaviors of `defineScopes` / `setupHooks` are better pushed into a **Mixin** than
  hand-written per model ([mixins.md](./mixins.md)). For example, "clone to a history table on
  every save" is not written directly in `setupHooks`; you pass `BackupMixinModel`. Add a scope /
  hook per model only for one-off requirements a Mixin cannot express.
- `defineSubqueries` is implemented in models that need a correlated subquery (e.g.
  `CustomerOrder.js`; read the physical column name via the attribute's `.field`). Leave it as a
  noop in models that do not use it.
