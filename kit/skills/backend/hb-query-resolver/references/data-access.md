# Data access (finders, pagination, includes, extraction)

How a query resolver reads and shapes data: where-clause builders, the count+findAll pagination
trio, association `include` trees, model `subquery()`, and `FieldPathValueExtractor`. Referenced from
§3 and §6 of [SKILL.md](../SKILL.md).

> The `User` / `UserProfile` / `Department` / `Office` / `Role` names are placeholder domain names —
> swap in your own models and fields.

## Finders are thin; the query shape lives in its own method

Keep `resolve()` a pipeline by giving each read its own small method. A finder wraps one Sequelize
call; the where clause, pagination, and includes are built by dedicated helpers so each is
independently testable.

- **One record:** `Model.findByPk(id, { include })` or `Model.findOne({ where, include })`, followed
  by a not-found guard in `resolve()` that throws a domain error
  ([errors-and-context.md](./errors-and-context.md)).
- **A list:** `Model.findAll({ where, offset, limit, order })`.
- **A count:** `Model.count({ where })` — used for `totalRecords`.

```js
async findUser ({
  userId,
  activeRoleId,
}) {
  return /** @type {Promise<UserWithAssociations | null>} */ (
    User.findByPk(userId, {
      include: [
        {
          model: UserRoleAssignment,
          required: true,
          where: {
            RoleId: activeRoleId,
          },
        },
        UserProfile,
      ],
    })
  )
}
```

- Cast the Sequelize return to your associated-entity typedef with a `/** @type {...} */ ( ... )`
  wrapper — the model methods return loosely-typed instances.

## Pagination: the count + findAll trio

A paginated list query is always the same three steps, driven from `resolve()`:

1. `buildWhereClause()` — turn the input filters into a Sequelize `where` object.
2. `countX({ whereClause })` — total matching rows, **before** paging, for `totalRecords`.
3. `findX({ whereClause, pagination })` — the page, applying `offset` / `limit` / `order`.

```js
const whereClause = this.buildWhereClause({ departmentId, keyword })
const totalRecords = await this.countUsers({ whereClause })
const users = await this.findUsers({ whereClause, pagination })
```

- **Both** the count and the find use the **same** `whereClause`, so the total matches the filter.
- `pagination` is destructured in the finder with a **default sort** so a missing `sort` still
  produces a deterministic order:

  ```js
  pagination: {
    limit,
    offset,
    sort = {
      targetColumn: 'name',
      orderBy: 'ASC',
    },
  },
  // ...
  order: [
    [sort.targetColumn, sort.orderBy],
  ],
  ```

- `formatResponse()` **echoes** the pagination back (`limit` / `offset` / `sort` / `totalRecords`) so
  the client can render the pager ([response formatting](#formatresponse-shape-dont-leak-models)).
- The allowed `sort` columns are enforced by the `*InputValidator`, not here
  (`hb-resolver-validator`).

## buildWhereClause: accumulate conditions, combine with Op.and

Build the `where` by pushing each active filter onto a `conditions` array, then combine. Skip a
filter when its input is absent so an empty input means "no filter" (return `{}`).

```js
buildWhereClause ({
  departmentId,
  keyword,
}) {
  const conditions = []

  const keywordInspector = ValueInspector.create({
    value: keyword,
  })

  if (
    keywordInspector.isPresent()
    && keyword.trim().length > 0
  ) {
    conditions.push({
      [Op.or]: [
        {
          id: {
            [Op.in]: UserProfile.subquery(
              '?firstName?lastName.UserId',
              {
                keyword,
              }
            ),
          },
        },
        {
          name: {
            [Op.like]: `${keyword}%`,
          },
        },
      ],
    })
  }

  if (departmentId) {
    conditions.push({
      DepartmentId: departmentId,
    })
  }

  if (conditions.length === 0) {
    return {}
  }

  return {
    [Op.and]: conditions,
  }
}
```

- Import `Op` from `sequelize`. Use `[Op.like]` for prefix search (`` `${keyword}%` ``), `[Op.or]`
  for multi-column keyword match, `[Op.in]` with a subquery for a related-table filter.
- Import `ValueInspector` from `@openreachtech/mentsu-value-inspector`;
  `ValueInspector.create({ value: keyword }).isPresent()` guards `null` / `undefined` before
  `keyword.trim()`. The package has no string/blank inspector (presence + number / integer / date
  only), so the blank `.trim().length > 0` check stays inline.
- `Model.subquery('<field-spec>', { keyword })` returns a subquery usable inside `[Op.in]` — it lets a
  keyword filter reach columns on an associated table (here `UserProfile`) without a join. Match the
  field-spec string to the model's declared subquery.

## Association includes

Read nested data with an `include` tree passed to the finder. Bare models include the whole
association; an object form adds `where` / `required` / `as` / nested `include`.

```js
include: [
  UserProfile,                          // include the whole association
  {
    model: Office,
    as: 'HomeOffice',                   // aliased association (same model, distinct role)
  },
  {
    model: Office,
    as: 'BranchOffice',
  },
  {
    model: Department,
    include: [
      Office,                           // nested include
    ],
  },
  {
    model: UserRoleAssignment,
    required: true,                     // INNER JOIN — filters the parent
    where: {
      RoleId: activeRoleId,
    },
  },
]
```

- `required: true` makes it an inner join (the parent row is dropped when the association is absent) —
  use it to filter by a related table. Default is a left join.
- Add `separate: true` to a `hasMany` include that needs its **own `order` / `limit`** — Sequelize
  runs it as a separate query, which also avoids the N+1 a bare nested `hasMany` can cause on a large
  parent set.
- Describe the resulting shape with an associated-entity `@typedef`
  ([anatomy.md](./anatomy.md#the-trailing-typedef-block)) so the extractor and `formatResponse` are
  type-checked.

## formatResponse: shape, don't leak models

`formatResponse()` maps the model entities to the schema's field names and is the only place that
builds the output object. Never return a raw model instance.

- Rename columns to schema fields (`user.id` → `userId`).
- Map arrays to their output shape; `filter` out records whose required association is missing.
- Default missing scalars (`?? ''` / `?? null`) — do not leak `undefined`.
- **Money / decimal fields → strings.** Emit a decimal (money, rate) via `BigNumber(value).toFixed(2)`
  (compute into a named `const` first), matching the `String!` SDL money type (`hb-graphql-schema`) —
  never a raw JS number.
- Echo pagination for lists.

### Deep values via FieldPathValueExtractor

When a value sits several associations deep, pull it with `FieldPathValueExtractor` instead of
walking `a?.b?.c` by hand. Create one per root entity and read by dotted field path:

```js
const userFieldPathValueExtractor = FieldPathValueExtractor.create({
  originEntity: user,
})

const bio = userFieldPathValueExtractor.extractFieldPathValue({
  fieldPath: 'User.UserProfile.bio',
})
```

- The path starts at the **root model name** and walks association names down to the column.
- For an optional nested object, extract the id first and branch:

  ```js
  const departmentId = extractor.extractFieldPathValue({
    fieldPath: 'User.Department.id',
  })

  return {
    department: departmentId
      ? {
        departmentId,
        name: extractor.extractFieldPathValue({ fieldPath: 'User.Department.name' }),
      }
      : null,
  }
  ```

- Guard array associations with `?? []` before `map`, and drop incomplete records with `filter`:

  ```js
  roles: (user.UserRoleAssignments ?? [])
    .filter(record => record?.Role?.name)
    .map(record => ({
      roleId: record.Role.id,
      name: record.Role.name,
    })),
  ```
