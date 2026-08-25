# Notation (class skeleton, imports, attribute declarations)

How to declare the model class, imports, and the attributes inside `createAttributes()`.
Referenced from `SKILL.md`. For the method ordering see [default-methods.md](./default-methods.md).

## One model per file, filename matches class name

One class per file, placed directly under `sequelize/models/`. The filename is the
**(singular) PascalCase class name** (`CustomerOrder.js` / `OriginObjectCategory.js`).

- **Why**: the `SequelizeActivator` in `sequelize/_.js` scans `modelsPath` and registers each
  model by its class name. Because filename, class name, and registered name all match, other
  models can reference it as `this._.CustomerOrder` ([associations.md](./associations.md)). If the
  names drift apart, association resolution grabs `undefined`.

## Extend BaseAppRenchanModel and default-export

A model extends the shared app base **`BaseAppRenchanModel`**
(`sequelize/baseModel/BaseAppRenchanModel.js`) and is exposed with `export default class`.
`BaseAppRenchanModel` extends `RenchanModel` from `@openreachtech/renchan-sequelize` and is the
layer that adds app-specific shared implementation. The class body consists only of the six
override methods ([default-methods.md](./default-methods.md)).

- **Why**: a model must never extend Sequelize's `Model` directly, nor even `RenchanModel`
  directly. When you want to add shared behavior (helpers, default options, etc.), routing every
  model through `BaseAppRenchanModel` lets you extend it in **one place**. Default to the more
  extensible `BaseAppRenchanModel`; when you need to add app-specific implementation on top of
  `RenchanModel`, define and collect it in this `BaseAppRenchanModel`.

```js
// Good example
import {
  ModelAttributeFactory,
} from '@openreachtech/renchan-sequelize'

import BaseAppRenchanModel from '../baseModel/BaseAppRenchanModel.js'

/**
 * CustomerOrder model
 *
 * @class CustomerOrder
 * @extends {BaseAppRenchanModel}
 */
export default class CustomerOrder extends BaseAppRenchanModel {
  // createAttributes / createOptions / associate / defineScopes / defineSubqueries / setupHooks
}
```

- **Exception**: only models that handle a tree (Fertile Forest) extend `FertileForestModel`
  (exported as `FertileForestModel` from the package; `CustomerReferralNode` is one). This
  delegates the tree's queue/depth operations to the framework. Ordinary master / transaction
  tables always use `BaseAppRenchanModel`.

## Import only the package, the app base, and domain constants

Imports are limited to the shared app base `BaseAppRenchanModel` (relative path),
`@openreachtech/renchan-sequelize` (`ModelAttributeFactory` / Mixins / etc.), and **domain
constants** that hold the values used in place of `ENUM` (`app/domain/*`).

- **Why**: a model is a declaration-only layer. Importing business logic or external I/O gives
  the model side effects and breaks initialization order and tests. When you need a set of
  allowed values, pull it from a domain constant instead of a DB `ENUM` (as in
  [timestamps.md](./timestamps.md), "values are managed in the app layer / constants").

## Spread the PK from the factory

Spread `...factory.ID_BIGINT` at the **top** of the object returned by `createAttributes()`. Use
`...factory.ID_INTEGER` when you need an integer PK. Never hand-write `id`.

- Build the factory with `const factory = ModelAttributeFactory.create(DataTypes)`.
- **Why**: so you never get the `bigint` / `autoIncrement` / `primaryKey` / `allowNull:false`
  four-piece set wrong. The PK declaration reads as a single token across every model and lines
  up with `...factory.ID_BIGINT` on the migration side
  (`hb-sequelize-migration`).

```js
// Good example
static createAttributes (DataTypes) {
  const factory = ModelAttributeFactory.create(DataTypes)

  return {
    ...factory.ID_BIGINT,

    registeredAt: {
      type: DataTypes.DATE(3),
      allowNull: false,
    },
  }
}
```

```js
// Bad example (hand-writing id)
return {
  id: {
    type: DataTypes.BIGINT,
    autoIncrement: true,
    primaryKey: true,
  },
  // ...
}
```

## Attribute keys are camelCase, types come from DataTypes

Attribute keys are **camelCase** (`registeredAt` / `questionsJson`). Do not write the physical
column name (snake_case) on the model side — `underscored: true` maps it automatically
([default-methods.md](./default-methods.md#createoptions-spreads-supercreateoptions-and-adds-only-extras)).
Use the `DataTypes` in the table below.

| Type | Use |
| --- | --- |
| `BIGINT` | PK / FK-like id |
| `INTEGER` | small integer PK, quantity, version |
| `STRING(n)` | variable-length string (`191` is the default length; pick `8`/`16`/`32`/`64` by use) |
| `TEXT` | long text (body, message) |
| `DATE(3)` | millisecond-precision datetime (`registeredAt` / `savedAt`, etc.) |
| `BOOLEAN` | truth value (`isActive`, etc.) |
| `JSON` | structured data (`questionsJson` / `resultJson`) |
| `DECIMAL(p, s)` | money / rate (`dailyRate`, etc.) |
| `BLOB('long')` | binary (uploaded file body) |
| `ENUM(...)` | **avoid by default**. Use a domain constant + `STRING(n)` instead |

- Datetimes default to `DATE(3)`. Make millisecond precision the default rather than plain `DATE`
  (for ordering comparisons and history uniqueness).
- Do not default string lengths to "255 for now"; choose by use (identifiers `STRING(32)`,
  display names / emails and the like `STRING(191)`). Match the migration's physical column length.
- **Prefer defining the TypeScript type (interface) in `type.d.ts`** and collecting it into the
  TypeScript global namespace `model`. Do not use a JSDoc `@typedef` at the bottom of the model
  file. Express the DataType-to-TS-type mapping on that `type.d.ts` side.

## Always declare allowNull, and defaultValue when a default exists

Declare **`allowNull`** on every attribute. Declare **`defaultValue`** on any column that has a
default.

- **Why**: omitting `allowNull` falls back to Sequelize's default (`true`), so the NOT NULL
  intent is not conveyed to the reader and diverges from the migration (which declares
  `allowNull`). Omitting `defaultValue` means the code cannot tell "what goes in when unspecified".
- Keep the declared `allowNull` / `defaultValue` in sync with the identically named column in the
  migration.

```js
// Good example
category: {
  type: DataTypes.STRING(64),
  allowNull: false,
  defaultValue: 'default',
},
isActive: {
  type: DataTypes.BOOLEAN,
  allowNull: false,
  defaultValue: true,
},
version: {
  type: DataTypes.INTEGER,
  allowNull: false,
  defaultValue: 1,
},
```

```js
// Bad example (allowNull omitted, default unclear)
category: {
  type: DataTypes.STRING(64),
},
```

## FK-like columns start with an uppercase letter and carry a comment

For a foreign-key-like column, make the attribute key **start with an uppercase letter**
(`CustomerOrderId` / `TenantBrandId`) and write **`// ForeignKey must start with upper case.`
immediately above it**. The type is `BIGINT`.

- **Why**: Sequelize associations ([associations.md](./associations.md)) resolve the FK name by
  the convention "`<associated model name>` + `Id`". Aligning on an uppercase start lets
  `belongsTo(this._.CustomerOrder)` bind `CustomerOrderId` automatically; lowerCamel
  (`customerOrderId`) fails to wire the relation. The migration side follows the same convention
  (uppercase key + the same comment) and maps `field:` to snake (`customer_order_id`).
- Do not drop the leading comment either, so the column reads as an FK at a glance.

```js
// Good example
// ForeignKey must start with upper case.
CustomerOrderId: {
  type: DataTypes.BIGINT,
  allowNull: false,
},
// A nullable FK (optional relation) also declares allowNull explicitly.
// ForeignKey must start with upper case.
TenantBrandId: {
  type: DataTypes.BIGINT,
  allowNull: true,
},
```

```js
// Bad example (lowerCamel, no comment; the association cannot resolve the FK)
customerOrderId: {
  type: DataTypes.BIGINT,
  allowNull: false,
},
```

## Unique constraints are enforced by the migration's named index

For a column that is unique (a 1:1 relation FK, a natural key), you **may** add `unique: true`
to the model attribute to **state intent**. The **actual constraint, however, is enforced by the
migration's named unique index**
(`hb-sequelize-migration`).

- **Why**: the schema is built by migrations, not by `sync`. `unique: true` on the
  model alone does not create a constraint (it has no effect on the DB). The model side is a
  reader-facing declaration that "this column is meant to be unique"; the DB constraint is the
  migration's job. When you write it on both sides, keep them consistent.

```js
// Good example (1:1 relation FK; the real constraint is the migration's unique index)
// ForeignKey must start with upper case.
CustomerOrderId: {
  type: DataTypes.BIGINT,
  allowNull: false,
  unique: true,
},
```
