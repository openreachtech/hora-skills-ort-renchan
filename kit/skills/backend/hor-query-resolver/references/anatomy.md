# Anatomy (the full resolver template + typedefs)

The complete member-by-member shape of a query resolver, the minimal no-input variant, and the
trailing `@typedef` block. Referenced from §2 of [SKILL.md](../SKILL.md).

> The `users` / `User` / `Department` / `Role` names below are placeholder domain names — swap in your
> resource, fields, and endpoint.

## Full template (a paginated list query)

This is the canonical shape: `schema` getter → `errorCodeHash` → `resolve()` (validate → read →
format) → validation wiring → finders → `formatResponse()`, then the typedefs. Members appear in the
fixed order; each does one job.

```js
import {
  Op,
} from 'sequelize'

import {
  BaseQueryResolver,
} from '@openreachtech/renchan'

import UsersInputValidator from '../../../../../../app/tools/Validator/forResolver/admin/queries/UsersInputValidator.js'

import User from '../../../../../../sequelize/models/User.js'
import UserProfile from '../../../../../../sequelize/models/UserProfile.js'

/**
 * Resolve the users query.
 *
 * @extends {BaseQueryResolver}
 */
export default class UsersQueryResolver extends BaseQueryResolver {
  /** @override */
  static get schema () {
    return 'users'
  }

  /**
   * .get:errorCodeHash
   *
   * @override
   * @returns {ErrorCodeHash}
   */
  static get errorCodeHash () {
    return {
      ...super.errorCodeHash,

      // Invalid Input Errors (203 prefix)
      InvalidKeyword: '203.Q001.001',
      InvalidDepartmentId: '203.Q001.002',
      InvalidPaginationLimit: '203.Q001.003',
      InvalidPaginationOffset: '203.Q001.004',
      InvalidPaginationSort: '203.Q001.005',
    }
  }

  /**
   * Resolve the users query.
   *
   * @override
   * @param {{
   *   variables: {
   *     input: server.graphql.admin.UsersInput
   *   }
   * }} params
   * @returns {Promise<server.graphql.admin.UsersResult>}
   */
  async resolve ({
    variables: {
      input,
    },
  }) {
    const validationError = this.validateInput({
      input,
    })

    if (validationError) {
      throw validationError
    }

    const {
      departmentId,
      keyword,
      pagination,
    } = input

    const whereClause = this.buildWhereClause({
      departmentId,
      keyword,
    })

    const totalRecords = await this.countUsers({
      whereClause,
    })

    const users = await this.findUsers({
      whereClause,
      pagination,
    })

    return this.formatResponse({
      users,
      pagination,
      totalRecords,
    })
  }

  /**
   * Validate the input of the users query.
   *
   * @param {{
   *   input: server.graphql.admin.UsersInput
   * }} params
   * @returns {InstanceType<RenchanGraphqlErrorCtor> | null}
   */
  validateInput ({
    input,
  }) {
    const validator = this.createInputValidator({
      input,
    })

    return validator.validateInput()
  }

  /**
   * Create a UsersInputValidator instance.
   *
   * @param {{
   *   input: server.graphql.admin.UsersInput
   *   errorHash?: ErrorHash
   * }} params
   * @returns {UsersInputValidator}
   */
  createInputValidator ({
    input,
    errorHash = this.errorHash,
  }) {
    return UsersInputValidator.create({
      input,
      errorHash,
    })
  }

  /**
   * Build the where clause for the users query.
   *
   * @param {{
   *   departmentId?: number
   *   keyword?: string
   * }} params
   * @returns {object}
   */
  buildWhereClause ({
    departmentId,
    keyword,
  }) {
    const conditions = []

    if (
      keyword
      && keyword.trim().length > 0
    ) {
      conditions.push({
        name: {
          [Op.like]: `${keyword}%`,
        },
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

  /**
   * Count users.
   *
   * @param {{
   *   whereClause: object
   * }} params
   * @returns {Promise<number>}
   */
  countUsers ({
    whereClause,
  }) {
    return User.count({
      where: whereClause,
    })
  }

  /**
   * Find users.
   *
   * @param {{
   *   whereClause: object
   *   pagination: graphql.NormalPaginationInput
   * }} params
   * @returns {Promise<Array<model.User>>}
   */
  async findUsers ({
    whereClause,
    pagination: {
      limit,
      offset,
      sort = {
        targetColumn: 'name',
        orderBy: 'ASC',
      },
    },
  }) {
    return /** @type {Promise<*>} */ (
      User.findAll({
        where: whereClause,
        offset,
        limit,
        order: [
          [sort.targetColumn, sort.orderBy],
        ],
      })
    )
  }

  /**
   * Format the response for the users query.
   *
   * @param {{
   *   users: Array<model.User>
   *   pagination: graphql.NormalPaginationInput
   *   totalRecords: number
   * }} params
   * @returns {server.graphql.admin.UsersResult}
   */
  formatResponse ({
    users,
    pagination: {
      limit,
      offset,
      sort = null,
    },
    totalRecords,
  }) {
    return {
      users: users
        .map(user => ({
          userId: user.id,
          name: user.name,
          email: user.email,
          isActive: user.isActive,
        })),
      pagination: {
        limit,
        offset,
        sort,
        totalRecords,
      },
    }
  }
}

/**
 * @typedef {{
 *   InvalidKeyword: string
 *   InvalidDepartmentId: string
 *   InvalidPaginationLimit: string
 *   InvalidPaginationOffset: string
 *   InvalidPaginationSort: string
 * }} ErrorCodeHash
 */

/**
 * @typedef {Record<string, RenchanGraphqlErrorCtor>} ErrorHash
 */

/**
 * @typedef {typeof import('@openreachtech/renchan').RenchanGraphqlError} RenchanGraphqlErrorCtor
 */
```

## Member order (recap)

1. `static get schema ()`
2. `static get errorCodeHash ()`
3. `async resolve ()`
4. `validateInput ()`
5. `createInputValidator ()`
6. finders / helpers, **in call order** (`buildWhereClause` → `countX` → `findX`); unrelated helpers
   in dictionary order
7. `formatResponse ()`
8. error creators (`createXxxNotFoundError`), when built through helpers ([errors-and-context.md](./errors-and-context.md))

- A `constructor` / `static create ()` is added **only** when the resolver needs an extra
  dependency; the framework's `BaseResolver.create()` already builds the instance (injecting
  `errorHash` from `errorCodeHash`) for the common case, so most resolvers declare neither.

## Minimal variant (no input, no validator)

When the field takes no `input` (or only reads auth off `context`), drop the validation wiring
entirely. Still declare `schema` and `errorCodeHash`:

```js
import {
  BaseQueryResolver,
} from '@openreachtech/renchan'

import Department from '../../../../../../sequelize/models/Department.js'

export default class DepartmentsQueryResolver extends BaseQueryResolver {
  /** @override */
  static get schema () {
    return 'departments'
  }

  /** @override */
  static get errorCodeHash () {
    return {
      ...super.errorCodeHash,
    }
  }

  /** @override */
  async resolve () {
    const departmentEntries = /** @type {Array<*>} */ (
      await Department.findAll()
    )

    const departments = departmentEntries
      .map(({
        id,
        name,
      }) => ({
        id,
        name,
      }))

    return {
      departments,
    }
  }
}
```

## The trailing typedef block

Types tied to the DB and the GraphQL schema live in `/types` (`model.*`, `server.graphql.*`); the
resolver file only **aliases** them and declares its own local shapes. Keep the block at the bottom,
after the class. A resolver with associations typically declares:

- `ErrorCodeHash` — the keys of `errorCodeHash` (values `string`).
- `Input` / `Result` aliases — `@typedef {server.graphql.<endpoint>.XxxInput} XxxInput`.
- `ErrorHash` — `Record<string, RenchanGraphqlErrorCtor>`.
- `RenchanGraphqlErrorCtor` — `typeof import('@openreachtech/renchan').RenchanGraphqlError`.
- An **associated-entity** typedef describing the `include` tree, when a finder returns a record with
  nested associations:

```js
/**
 * @typedef {model.UserEntity & {
 *   UserProfile: model.UserProfileEntity
 *   Department: model.DepartmentEntity & {
 *     Office: model.OfficeEntity
 *   }
 *   UserRoleAssignments: Array<model.UserRoleAssignmentEntity & {
 *     Role: model.RoleEntity
 *   }>
 * }} UserWithAssociations
 */
```

- When the resolver reads auth or injected providers off `context`, also alias the context type:
  `@typedef {import('../../../../contexts/AdminGraphqlContext.js').default} AdminGraphqlContext`
  ([errors-and-context.md](./errors-and-context.md)).
