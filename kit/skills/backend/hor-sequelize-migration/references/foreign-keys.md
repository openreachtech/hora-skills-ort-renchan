# Foreign Keys (do not add DB FK constraints)

How to treat FK-like columns, and the policy of not creating DB-level foreign-key constraints.
Referenced from §3 of `SKILL.md`. For the FK column notation see [notation.md](./notation.md); for
the UNIQUE index that enforces 1:1 see [indexes.md](./indexes.md).

## Do not write `references` / `onDelete` / `onUpdate` / `addConstraint`

Do **not** create DB-level FK constraints. Do not put `references` on a column definition, do not
attach `onDelete` / `onUpdate`, and do not add an FK constraint via
`queryInterface.addConstraint(...)` (there is not a single FK constraint in the existing
migrations).

```js
// Good example (an FK-like column but no constraint — just the column + comment + a lookup index)
// ForeignKey must start with upper case.
CustomerId: {
  type: Sequelize.BIGINT,
  field: COLUMN_NAME.CUSTOMER_ID,
  allowNull: false,
},
// ...
await queryInterface.addIndex(TABLE_NAME, [
  COLUMN_NAME.CUSTOMER_ID,
], {
  name: [TABLE_NAME, SHORT_COLUMN_NAME.CUSTOMER_ID, 'index'].join('_'),
})
```

```js
// Bad example (adds a DB FK constraint)
CustomerId: {
  type: Sequelize.BIGINT,
  field: COLUMN_NAME.CUSTOMER_ID,
  allowNull: false,
  references: { model: 'customers', key: 'id' }, // ← do not write
  onDelete: 'CASCADE',                            // ← do not write
},
```

- **Why**: dev = SQLite / staging = MySQL / live = MariaDB differ, and there is no `sync` either. A
  DB FK constraint (1) pins insert / delete order, (2) makes cloning into backup (`*_bk`) tables
  hard, and (3) cannot express circular references. Referential integrity is enforced in the **app
  layer** (model associations and domain logic).

## Create the FK *column*; express the relation on the model side

Do not add the constraint, but **do create the column** that holds another table's id (`BIGINT`,
uppercase-starting, `// ForeignKey must start with upper case.`; see [notation.md](./notation.md)).
Declaring the relation that uses that column is the job of the model's `associate()`
(`hor-sequelize-model`). The migration goes as far as "column + lookup index"; the meaning of the
relation belongs to the model.

## Enforce 1:1 with a UNIQUE index, not an FK

A 1:1 relation (a child that has exactly one parent) enforces uniqueness with a **UNIQUE index** on
the parent-id column, not with an FK constraint (see [indexes.md](./indexes.md)). Attach the comment
verbatim.

```js
// A 1:1 relation is enforced by a UNIQUE index (no DB FK).
await queryInterface.addIndex(TABLE_NAME, [
  COLUMN_NAME.CONTENT_GENERATION_JOB_ID,
], {
  unique: true,
  name: [TABLE_NAME, SHORT_COLUMN_NAME.CONTENT_GENERATION_JOB_ID, 'unique'].join('_'),
})
```

## Circular FKs / optional relations: column-only and nullable

When two tables reference each other (a circular FK), or the relation is optional, keep just the
**column**, `allowNull: true`. With no constraint, even a cycle is fine, and an unresolved value can
be null.

```js
// ForeignKey must start with upper case. (circular FK, column only)
ContentGenerationJobId: {
  type: Sequelize.BIGINT,
  field: COLUMN_NAME.CONTENT_GENERATION_JOB_ID,
  allowNull: true,
},
```

- Example: `content_sessions` and `content_generation_jobs` each hold the other's id. Since no
  DB FK is added, both can hold the other as a column.

## A set of ids you don't want as FKs → a JSON array

When you want to hold a set of ids but not enough to warrant individual FK columns or a join table,
hold them in a `JSON`-typed array column. Same idea as having no FK constraint: check referential
integrity in the app layer.

```js
// An array of ids without an FK.
optionIdsJson: {
  type: Sequelize.JSON,
  field: COLUMN_NAME.OPTION_IDS_JSON,
  allowNull: true,
},
```

## Index the FK columns

Even without a constraint, an FK column is the starting point of joins and filters, so it usually
gets a **plain index** (see [indexes.md](./indexes.md)). A 1:1 uses a UNIQUE index, a 1:N uses a
plain index. A join table's composite key uses a composite UNIQUE index.
