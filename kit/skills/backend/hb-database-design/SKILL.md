---
name: hb-database-design
description: >
  Decide the logical shape of a renchan database schema — the design choices made before writing a
  migration or model. Use this skill whenever the user asks how to model a table, whether to
  normalize or denormalize, how to represent a status or category, which column type to pick, how
  to store times, how to scale reads as data grows, how to version a master table, or how to keep
  a table's update history. Writing the migration and the model are separate conventions.
---

# Database Design

A skill for the **schema-design decisions** that come *before* the mechanics: what tables and
columns should exist, how they relate, and what each column's type and meaning is. The physical
declaration (migration files, DataTypes, indexes) is written by `hb-sequelize-migration`; the logical
declaration on top (model attributes, associations) by `hb-sequelize-model`. This skill decides
**what** to put in them and **why**. The individual conventions are split across the detail files
below — consult them as needed.

## Grand principle: the database holds canonical, normalized truth

The database is the **single source of truth**, and it stores that truth in its **canonical,
non-redundant** form. Anything that is *derived* (aggregates, search indexes), *presentational*
(timezone, human-readable labels), or *volatile / large* (files, dynamic blobs) is kept **out of
the normalized core** and lives in a separate structure or in another layer. Every rule in the
detail files is this principle applied to one kind of data.

- **Why**: when the canonical tables stay minimal and non-redundant, each fact lives in exactly one
  place, so responsibility boundaries are clear and the structure stays flexible as requirements
  change — which keeps the schema stable over the project's long life. The moment derived or
  presentational data leaks into the core, that data drifts out of sync, makes the schema rigid,
  and every later change has to reconcile duplicates.
- **When a rule and performance conflict, do not compromise the core** — add a separate, additive,
  rebuildable structure (a summary table, a search DB) beside it. Never fix a query-speed concern
  by corrupting the write model.

This skill is design-level. Whenever a decision needs to be *written*, cross to `hb-sequelize-migration`
(column types, `DATE(3)`, `TEXT('medium')`, `JSON`, no DB foreign-key constraint, indexes) and
`hb-sequelize-model` (attributes, timestamps, and the Mixins that implement versioning and archiving).
Code comments in the examples are English, matching those sibling skills.

## Detail files

- [normalization.md](./references/normalization.md) — normalize to 3NF; when reads grow, add a
  `summary_` table or a search DB instead of denormalizing the core
- [datetimes.md](./references/datetimes.md) — separate business datetimes from the ORM's audit
  timestamps; store every datetime as UTC at millisecond precision (`DATE(3)`)
- [master-tables.md](./references/master-tables.md) — model a status / category as a master table +
  key column (not free strings, rarely `ENUM`); version a master table (a price list) by splitting
  the version table from its rows
- [column-types.md](./references/column-types.md) — pick a column's type from the shape of its data
  (`JSON` / `TEXT` / `TEXT('medium')`); keep files in external storage and store only a reference
- [update-history.md](./references/update-history.md) — retain a table's update log with the archive
  pattern (`BackupMixinModel` + a `*_bk` table)
