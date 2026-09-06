# Associations (how to write associate())

Conventions for declaring relations between models in `associate()`. Referenced from `SKILL.md`.
For method ordering and the `super`-call template see
[default-methods.md](./default-methods.md#even-unused-extension-points-call-super-and-keep-a-noop);
for FK column notation see
[notation.md](./notation.md#fk-like-columns-start-with-an-uppercase-letter-and-carry-a-comment).

## Reference the associated model via `this._.<ModelName>`

Always reference the associated model via **`this._.<ModelName>`**. `this._` is the
`sequelize.models` (the hash of registered models) returned by the base `RenchanModel`.

- **Why**: models cross-reference each other across files, so a direct import causes a circular
  dependency. `this._` is resolved after all models are registered, so it pulls the associated
  model while avoiding the cycle. The reference name matches the class name = filename
  ([notation.md](./notation.md#one-model-per-file-filename-matches-class-name)), so you spell it
  `this._.Customer`.
- Remember to put `super.associate?.()` first (so a Mixin's relations are not swallowed;
  [default-methods.md](./default-methods.md#even-unused-extension-points-call-super-and-keep-a-noop)).

```js
// Good example
/**
 * Define model associations
 */
static associate () {
  super.associate?.()

  this.belongsTo(this._.Customer)
}
```

```js
// Bad example (directly importing the associated model, inviting a circular dependency)
import Customer from './Customer.js'
// ...
this.belongsTo(Customer)
```

## Choose the association type to match the relationship

Pick among Sequelize's four methods by which side holds the FK column in the DB and by
multiplicity. The FK column is defined on the **side that holds the FK**, following the
[notation.md](./notation.md#fk-like-columns-start-with-an-uppercase-letter-and-carry-a-comment)
convention (uppercase start).

| Method | Meaning | Side holding the FK |
| --- | --- | --- |
| `this.belongsTo(this._.X)` | I reference one X (I hold the FK) | **me** |
| `this.hasOne(this._.X)` | X references me once (1:1) | the other (X) |
| `this.hasMany(this._.X)` | X references me many times (1:N) | the other (X) |
| `this.belongsToMany(this._.X, { through: this._.Y })` | many-to-many with X (through join table Y) | the join table (Y) |

- `belongsTo` and `hasOne` / `hasMany` are **two sides of the same coin**. Write `belongsTo` on
  the child side that holds the FK, and `hasOne` / `hasMany` on the parent side (you may declare
  both sides).
- `belongsToMany` must be given the join model in `through`. The join model itself is an ordinary
  model with a `belongsTo` to each side ([the join-table example](#a-join-table-has-a-belongsto-to-each-side)).

```js
// Good example (parent CustomerOrder side — children hold the FK, so hasOne / hasMany / belongsToMany)
/**
 * Define model associations
 */
static associate () {
  super.associate?.()

  this.hasOne(this._.CustomerOrderTotalPrice)
  this.hasOne(this._.CustomerOrderLatestStatus)

  this.hasMany(this._.CustomerOrderProduct)

  this.belongsToMany(this._.BrandShipment, {
    through: this._.BrandShipmentOrder,
  })
}
```

```js
// Good example (child CustomerOrder side — it holds CustomerId, so belongsTo)
/**
 * Define model associations
 */
static associate () {
  super.associate?.()

  this.belongsTo(this._.Customer)
}
```

## Pass association options only when the default inference is wrong

Sequelize resolves the FK by the convention "`<associated model name>` + `Id`"
([notation.md](./notation.md#fk-like-columns-start-with-an-uppercase-letter-and-carry-a-comment)).
When the FK column follows that convention, call the association method with the model alone.
Pass an options object only when the default inference is wrong — `through` for `belongsToMany`
(previous section), and `foreignKey` when the FK attribute departs from the convention.

- **Why**: restating an option the inference already gets right is noise that hides the real
  signal ("this association is irregular"). Conversely, when a model holds a **role-named FK**
  (or two FKs pointing at the same model), the inferred `<ModelName>Id` does not exist, the
  relation silently binds the wrong column, and `include` fails — so name the FK explicitly.

```js
// Good example (the FK follows the convention; no options)
this.belongsTo(this._.Customer)

// Good example (the child's FK is role-named, so inference fails; name it explicitly)
this.hasMany(this._.TabGroupDisplayTab, {
  foreignKey: 'DisplayTabOriginCategoryId',
})
```

```js
// Bad example (restating the option the inference already resolves)
this.belongsTo(this._.Customer, {
  foreignKey: 'CustomerId',
})
```

## A declared association is read off the instance by the model name

An association declared in `associate()` determines the property name under which `include`
attaches the loaded rows: `belongsTo` / `hasOne` attach under the **singular model name**,
`hasMany` / `belongsToMany` under the **pluralized model name**.

- **Why**: the property comes from the association declaration, not from the FK column, so
  knowing this mapping tells you what an `include` produces without inspecting the result. It is
  also why the reference name must match the class name
  ([notation.md](./notation.md#one-model-per-file-filename-matches-class-name)).

```js
// The declaration determines the property name on a loaded instance
const order = await CustomerOrder.findOne({
  include: [
    CustomerOrderTotalPrice,
    CustomerOrderProduct,
  ],
})

order.CustomerOrderTotalPrice // hasOne / belongsTo → singular model name
order.CustomerOrderProducts // hasMany / belongsToMany → pluralized model name
```

## A join table has a belongsTo to each side

A many-to-many join-table model writes a **`belongsTo` to each end**. It holds the FK columns
(each end's `<Model>Id`) as attributes, and adds `paranoid`
([default-methods.md](./default-methods.md#when-to-add-paranoid)) when it soft-deletes.

- **Why**: `belongsToMany(..., { through })` goes through the join table, but the join table
  itself must know its relations to both ends. Linking the join table as an ordinary model with a
  `belongsTo` to each end lets you find the join table directly and include both ends.

```js
// Good example (BrandShipmentOrder — the join table between CustomerOrder and BrandShipment)
export default class BrandShipmentOrder extends BaseAppRenchanModel {
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

      CustomerOrderId: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      BrandShipmentId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
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

      paranoid: true, // for deleted_at column
    }
  }

  /**
   * Define model associations
   */
  static associate () {
    super.associate?.()

    this.belongsTo(this._.CustomerOrder)
    this.belongsTo(this._.BrandShipment)
  }

  // defineScopes / defineSubqueries / setupHooks are noop
}
```

## Do not add DB foreign-key constraints (enforce in the app layer)

Express relations with Sequelize associations **only**. Do not add DB foreign-key constraints
(`references` / `onDelete` / `onUpdate`)
(`hor-sequelize-migration`).

- **Why**: referential integrity is enforced in the app layer (transactions, existence checks).
  Not adding constraints keeps migration ordering, record deletion, and sqlite tests simple. A
  model's `belongsTo` etc. are **declarations for JOIN and include**, independent of DB constraints.
