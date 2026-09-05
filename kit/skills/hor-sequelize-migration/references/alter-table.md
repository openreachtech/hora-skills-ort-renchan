# Alter Table (adding / removing columns)

How to write migrations that add or remove columns on an existing table. Referenced from §5 of
`SKILL.md`. The column type / `field` / `allowNull` notation is shared with
[notation.md](./notation.md).

## Add with addColumn, drop with raw SQL DROP COLUMN (symmetric up/down)

`addColumn` in `up`, and drop the same column in `down` to keep them symmetric. The filename is
`{timestamp}-{seq}-alter_table-<table>-<column>.cjs`.

**Do not use `removeColumn` to drop a column.** Sequelize's `removeColumn` does not work correctly
on MariaDB (live), so drop a column — in `up` or `down` — with raw SQL
`ALTER TABLE ... DROP COLUMN` via `queryInterface.sequelize.query`. Quote identifiers with backticks
(valid on both SQLite and MariaDB).

```js
'use strict'

/*
 * Add webhook_url to content_generation_jobs (TICKET-1234).
 * The destination that notifies an external system of an integration job's completion / failure.
 * When unset, the Worker falls back to integration_clients.default_webhook_url.
 */

const TABLE_NAME = 'content_generation_jobs'
const COLUMN_NAME = 'webhook_url'

module.exports = {
  async up (
    queryInterface,
    Sequelize
  ) {
    await queryInterface.addColumn(TABLE_NAME, COLUMN_NAME, {
      type: Sequelize.STRING(500),
      allowNull: true,
    })
  },

  async down (
    queryInterface,
    Sequelize
  ) {
    // removeColumn does not work on MariaDB, so drop via raw SQL DROP COLUMN.
    await queryInterface.sequelize.query(`
      ALTER TABLE \`${TABLE_NAME}\`
      DROP COLUMN \`${COLUMN_NAME}\`
    `)
  },
}
```

- **Why (symmetry)**: writing `down` symmetrically lets the migration be rolled back (drop in `down`
  exactly what `up` added). Unlike `createTable`, a column add does not use `MigrationAttributeFactory`
  (the PK / timestamps already exist on the table), so a `require` is often unnecessary.
- **Why (raw SQL)**: `queryInterface.removeColumn` does not work correctly on MariaDB. To stay
  dialect-independent, run `ALTER TABLE ... DROP COLUMN` directly. The add side (`addColumn`) is
  fine, so keep using it.

## Write an intent comment (`/* ... */`) at the top

A column-adding migration is really about "why is this column being added", so put a `/* ... */`
block at the top describing the intent. Leave the ticket number, the spec section, and backward-
compat notes (e.g. why it does not break the existing flow).

- **Why**: even a single-column add cannot be reviewed or rolled back confidently without the
  background (which feature, which spec). The intent lives only in the comment, not in the code. As
  a domain note it may be written in Japanese (see the grand principle in `SKILL.md`).

## A single column is a string; multiple columns are a `COLUMN_NAME` object

For a single column, `COLUMN_NAME` may be a string. For multiple, make `COLUMN_NAME` an object. The
`up` `addColumn`s can be grouped with `Promise.all`, but the `down` column drops are run as **one
raw statement per column, sequentially** (SQLite can only drop one column per statement, so do not
merge them into one statement — split per column).

```js
const TABLE_NAME = 'content_sessions'
const COLUMN_NAME = {
  WIZARD_ANSWERS_JSON: 'wizard_answers_json',
  WIZARD_TEMPLATE_ID: 'wizard_template_id',
  WIZARD_TEMPLATE_VERSION: 'wizard_template_version',
}

module.exports = {
  async up (
    queryInterface,
    Sequelize
  ) {
    await Promise.all([
      queryInterface.addColumn(TABLE_NAME, COLUMN_NAME.WIZARD_ANSWERS_JSON, {
        type: Sequelize.JSON,
        allowNull: true,
      }),
      queryInterface.addColumn(TABLE_NAME, COLUMN_NAME.WIZARD_TEMPLATE_ID, {
        type: Sequelize.INTEGER,
        allowNull: true,
      }),
      queryInterface.addColumn(TABLE_NAME, COLUMN_NAME.WIZARD_TEMPLATE_VERSION, {
        type: Sequelize.INTEGER,
        allowNull: true,
      }),
    ])

    return Promise.resolve()
  },

  async down (
    queryInterface,
    Sequelize
  ) {
    // removeColumn does not work on MariaDB, so drop per column with raw SQL DROP COLUMN.
    await queryInterface.sequelize.query(`
      ALTER TABLE \`${TABLE_NAME}\`
      DROP COLUMN \`${COLUMN_NAME.WIZARD_ANSWERS_JSON}\`
    `)
    await queryInterface.sequelize.query(`
      ALTER TABLE \`${TABLE_NAME}\`
      DROP COLUMN \`${COLUMN_NAME.WIZARD_TEMPLATE_ID}\`
    `)
    await queryInterface.sequelize.query(`
      ALTER TABLE \`${TABLE_NAME}\`
      DROP COLUMN \`${COLUMN_NAME.WIZARD_TEMPLATE_VERSION}\`
    `)

    return Promise.resolve()
  },
}
```

## Columns on a table with existing rows use `allowNull: true` or `defaultValue`

When adding a column to a table that already holds data, make it `allowNull: true` or give it a
`defaultValue`. Do not add a `NOT NULL` column that existing rows cannot satisfy (they would
violate it and the migration would fail). "All nullable for backward compatibility", as above, is
the default.

- When adding an FK column later, the notation is the same as in `createTable` — type `BIGINT`,
  uppercase-starting key, `// ForeignKey must start with upper case.` (see
  [notation.md](./notation.md)). Do not add a DB FK constraint
  ([foreign-keys.md](./foreign-keys.md)). If it is used in lookups, `addIndex` it separately (see
  [indexes.md](./indexes.md)).

## Applying changes

After adding or changing a column, rebuild the local DB with `npm run r` (`db:refresh`) to apply it
(see the "Applying changes to the local DB" section of `SKILL.md`).
