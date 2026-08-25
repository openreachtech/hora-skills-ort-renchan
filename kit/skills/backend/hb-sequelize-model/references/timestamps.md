# Timestamps (do not include created_at / updated_at in the model)

Conventions for how to treat `created_at` / `updated_at` (and `deleted_at`) in the model
declaration. Referenced from `SKILL.md`. For the migration side, see
`hb-sequelize-migration`.

## Do not write timestamp columns in attributes

Do **not** put `createdAt` / `updatedAt` / `deletedAt` in the return value of
`createAttributes()`. Leave column creation to the migration (`...factory.TIMESTAMPS`) and value
management to `timestamps: true`
([default-methods.md](./default-methods.md#createoptions-spreads-supercreateoptions-and-adds-only-extras)).

- **Why**: these are operational columns **the application does not use** (for auditing / the
  framework). Putting them in attributes makes them look like values you read and write in
  business logic, and double-manages the assumptions of `practicalAttributeNames` (the list of
  real attributes the base `RenchanModel` returns with `createdAt` / `updatedAt` / `deletedAt`
  excluded) and `BackupMixinModel` (which excludes those same three columns when cloning).
  Centralize column definition in the migration and value supply in the framework, and keep the
  model's attributes to **business attributes only**.
- `timestamps: true` is already returned by the base `createOptions()`. Do not touch `timestamps`
  on the model side ([default-methods.md](./default-methods.md)).

```js
// Good example (business attributes only; do not write timestamps)
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
// Bad example (createdAt / updatedAt placed in attributes)
return {
  ...factory.ID_BIGINT,

  registeredAt: {
    type: DataTypes.DATE(3),
    allowNull: false,
  },
  createdAt: {
    type: DataTypes.DATE(3),
    allowNull: false,
  },
  updatedAt: {
    type: DataTypes.DATE(3),
    allowNull: false,
  },
}
```

## If you need a business "saved-at" time, use a dedicated datetime column

When you want to treat "when it was saved" as part of the business, do not repurpose `createdAt`;
define a dedicated column with a clear meaning (`savedAt` / `postedAt` / `registeredAt` /
`modifiedAt` / `generatedAt` / `effectiveAt`, etc., `DATE(3)`) in the attributes.

- **Why**: `createdAt` is the framework's audit column and makes no guarantee about when it
  changes operationally (backfill during migration, etc.). Split any datetime that business logic
  may depend on into a dedicated column whose intent shows in its name. The `savedAt` / `startedAt`
  that `BackupMixinModel` / `LatestStatusMixinModel` / `SuiteVersionMixinModel`
  ([mixins.md](./mixins.md)) use for ordering are also such dedicated datetime columns.
- Every name above ends with `At` because it carries a **time of day**; an attribute whose meaning
  stops at the **calendar date** ends with `On` instead (`billedOn`). A range is two attributes
  keeping the suffix (`modifiedAtFrom` / `modifiedAtTo`) — `From` / `To` mark the ends of a range,
  so a single instant that means "in effect from this moment" is `effectiveAt`, not `effectiveFrom`.
