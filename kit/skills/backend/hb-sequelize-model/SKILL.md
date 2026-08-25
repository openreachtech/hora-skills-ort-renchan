---
name: hb-sequelize-model
description: >
  Write and edit renchan/Sequelize model definitions (sequelize/models/*.js).
  Use this skill whenever the user asks to create or update a Sequelize model
  class — its attributes, createOptions, associations, scopes, hooks, or how to
  wire a MixinModel.
---

# Sequelize Model

A skill for writing the `sequelize/models/*.js` model definitions used in a renchan project.
The physical schema is defined by `hb-sequelize-migration`; this
skill writes the corresponding **logical declarations on top of Sequelize** (attributes /
association / scope / hook / Mixin). The conventions are split across the detail files below —
consult them as needed.

## Grand principle: a model is a filled-in template, not free-form code

Every model extends `BaseAppRenchanModel` and has the **same skeleton**. The six extension
points that form that skeleton (`createAttributes` / `createOptions` / `associate` /
`defineScopes` / `defineSubqueries` / `setupHooks`) are **always laid out in the same order,
even when unused**, and any that have no content keep `super.xxx?.()` plus `// noop`
([default-methods.md](./references/default-methods.md)).

- **Do not "delete to omit"**. Removing a method entirely makes it impossible to tell whether
  the model "has no such feature (i.e. it was considered)" or someone "forgot to write it".
  Keeping an explicit noop declares "considered, and not applicable". This is the same idea as
  the QA stance in `hc-jest` ("do not cut coverage using implementation
  knowledge") — to avoid mistaking *a gap* for *not-applicable*, always keep the extension
  points visible.
- Because the skeleton is identical across every model, review attention goes straight to the
  **model-specific differences** (attributes / associations). When the structure varies from
  model to model, it becomes impossible to read what is intentional and what is an omission.
- When in doubt, **lean toward the template**. Do not try to write it "cleverly" with custom
  static methods or a changed initialization order. Extend via a Mixin
  ([mixins.md](./references/mixins.md)) or a framework extension point.

## Write code comments in English

Comments inside model code (`.js`) — such as `// ForeignKey must start with upper case.` — are
written in **English**, to match the other comments in the codebase.

- This applies to comments inside the model code generated into `sequelize/models/` (the `//`
  and `/* */` in `.js`). They are artifacts, so English.
- The explanatory prose of this skill (the body text of each Markdown file) is in English as
  well.
- The comments inside **this skill's own examples** (```js``` blocks) are also in English.

## Keep a one-to-one correspondence with the migration

A model's attributes must correspond one-to-one with the columns of the matching
`hb-sequelize-migration`. The camelCase attribute keys on the model side map
to the snake_case physical columns (`field:`) on the migration side via `underscored: true`
([default-methods.md](./references/default-methods.md#createoptions-spreads-supercreateoptions-and-adds-only-extras)).

- **Why**: adding only one side produces an inconsistency — an attribute exists but the column
  does not (queries fail), or a column exists but the model cannot touch it. Always add or change
  columns in the migration and the model together.
- Timestamp columns are the exception; **do not** write them in the model's attributes
  ([timestamps.md](./references/timestamps.md)).

## Detail files

- [notation.md](./references/notation.md) — class skeleton, imports, attribute declarations
- [default-methods.md](./references/default-methods.md) — the six override methods and `createOptions`
- [timestamps.md](./references/timestamps.md) — do not include `created_at` / `updated_at` in the model
- [associations.md](./references/associations.md) — how to write `associate()` (relations via `this._`)
- [mixins.md](./references/mixins.md) — kinds of MixinModel and how to pass them (all 6)
