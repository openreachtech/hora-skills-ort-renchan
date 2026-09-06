---
name: hor-sequelize-subquery
description: >
  Define and consume named Sequelize subqueries on renchan models (this.addSubquery inside
  defineSubqueries in sequelize/models/*.js, consumed via Model.subquery(name, params) under Op.in
  in a where clause). Use this skill whenever a query must filter rows by a condition on a related
  / associated table — in this convention that is a subquery, not a JOIN — or whenever the user
  asks to define, name, or test a subquery.
---

# Sequelize Subquery

A skill for defining **named, reusable `SELECT`s** attached to a Sequelize model, and consuming
them from a resolver's `where` clause. A subquery is registered once on the model with
`this.addSubquery({ name, generator })` and consumed with `Model.subquery(name, params)`, which
returns a `Sequelize.Literal` (a real SQL subquery) — so you filter one model by the result of a
`SELECT` against another without writing a join or a raw SQL string at the call site.

Registration lives in `static defineSubqueries()`, one of the six extension points of the model
skeleton defined in `hor-sequelize-model` (an unused `defineSubqueries` stays as a noop there; this
skill covers what to write when it *is* used). The consuming side (building a resolver's
`where` clause) belongs to `hor-query-resolver` / `hor-mutation-resolver`; testing follows `hoc-jest`.

## Grand principle: the name is the query — a self-describing string registered on the model

The subquery API comes from `RenchanModel` in `@openreachtech/renchan-sequelize` — **never roll
your own** (no raw `Sequelize.literal('SELECT ...')` at a call site, no ad-hoc join to express a
cross-table filter). Register the `SELECT` on the model that owns it, and give it a name that
**encodes exactly its `where` conditions and its `select` columns**:

```
?<cond1>[<op1>]?<cond2>[<op2>].<result1>.<result2>
```

- **Condition columns (the `where`)** each start with `?`. The operator goes in square brackets
  `[...]` immediately after the column name; a plain equality has **no** brackets.
- **Result columns (the `select`)** each start with `.`.
- **The table name never appears in the name.** The subquery is added to a target model, so the
  table is self-evident from the model — the name encodes only conditions and results.
- **Why a self-describing name**: the consumer reads `'?CustomerId.id'` and knows, without
  opening the model, that it means "`WHERE customer_id = ?`, `SELECT id`". A free-form name
  (`'ordersOfCustomer'`) forces every reader back to the definition, and drifts silently when
  the definition changes.
- **Why registered on the model, not inlined at the call site**: the same cross-table filter is
  typically needed by several resolvers. A raw literal written inline duplicates SQL strings,
  escapes nothing into the model layer, and cannot be unit-tested as a pure generator.

```js
// Good: consume a named subquery registered on the model
const customerOrderSubquery = CustomerOrder.subquery('?CustomerId.id', {
  customerId,
})

const whereClause = {
  CustomerOrderId: {
    [Op.in]: customerOrderSubquery,
  },
}
```

```js
// Avoid: raw SQL literal at the call site
//   → duplicates the SELECT wherever it is needed, leaks physical column names
//     into the resolver, and cannot be tested as a pure generator.
const whereClause = {
  CustomerOrderId: {
    [Op.in]: Sequelize.literal(
      `(SELECT id FROM customer_orders WHERE customer_id = ${customerId})`
    ),
  },
}
```

## Comment language in the sample code

Comments in the `js` examples in this SKILL.md follow the prose language (here, **English**),
because the examples are *explanation* of the skill. Comments inside the **artifact this skill
produces** (the real model / resolver code) follow the **codebase** language — English — to match
the surrounding source.

## 1. When to reach for a subquery

Reach for a subquery when a resolver needs to constrain rows of model A by a condition that
lives on model B. Typical cases:

| Requirement | Shape |
| --- | --- |
| "Payments of the orders that belong to this customer" | Filter `OrderPayment` by `CustomerOrderId IN (SELECT id FROM customer_orders WHERE customer_id = ?)` |
| "Shipments whose **latest status** is in a given set" | Filter `Shipment` by `id IN (SELECT shipment_id FROM shipment_latest_statuses WHERE shipment_status_id IN (...))` |
| "Coupons valid **at** a point in time" | Filter by `id IN (SELECT coupon_id FROM coupon_settings WHERE valid_from <= ? AND valid_until >= ?)` |

- The subquery is defined **on the model that owns the condition columns** (the model whose
  table the inner `SELECT` reads), and its result columns are what the outer `where` matches
  against (usually an id / FK column).
- If the requirement is "load B *together with* A for output", that is an `include` association
  (`hor-sequelize-model` → associations), not a subquery. A subquery is for **filtering**, not
  eager-loading.

## 2. Naming convention and operator table

The operator inside `[...]` maps to a Sequelize `Op` symbol in the generator's `where`:

| format | meaning |
| :-- | :-- |
| (none) | set as value directly (plain equality) |
| `[=]` | `Op.eq` |
| `[>]` | `Op.gt` |
| `[>=]` | `Op.gte` |
| `[<]` | `Op.lt` |
| `[<=]` | `Op.lte` |
| `[in]` | `Op.in` |
| `[between]` | `Op.between` |
| `[like]` | `Op.like` |

- **"Set as value directly"**: when a condition is a plain equality, omit the brackets and
  assign the value straight onto the field — `?CustomerId.id` with a `where` of
  `{ [CustomerIdField]: customerId }`.
- Reading examples:
  - `?CustomerId.id` — "`WHERE CustomerId = ?`, `SELECT id`"
  - `?ShipmentStatusId[in].ShipmentId` — "`WHERE ShipmentStatusId IN (...)`, `SELECT ShipmentId`"
  - `?validFrom[<=].validUntil[>=].CouponId` — two conditions, each with its own operator
  - `?OriginObjectCategoryId?jobDivisionNumber.id` — two equality conditions (no brackets), one result

## 3. Register the subquery in `defineSubqueries()`

Register inside `static defineSubqueries()`. Call `super.defineSubqueries?.()` first (as with
every extension point in `hor-sequelize-model` — otherwise a Mixin's base behavior is lost),
read the physical field names off `this.getAttributes()`, then add each subquery with
`this.addSubquery({ name, generator })`.

The `generator` receives a params object and returns `{ attributes, where }`:

- `attributes` — the `SELECT` column list, as **DB field names** (take them from
  `this.getAttributes().<key>.field`, never hard-code snake_case strings).
- `where` — a Sequelize where clause, keyed by DB field names, using the `Op` symbols that the
  subquery name declares.

**Basic example** (single equality condition, single result):

```js
/**
 * Define model subqueries
 *
 * @override
 */
static defineSubqueries () {
  super.defineSubqueries?.()

  const allAttributes = this.getAttributes()
  const idField = allAttributes.id.field
  const CustomerIdField = allAttributes.CustomerId.field

  this.addSubquery({
    name: '?CustomerId.id',
    generator: ({
      customerId,
    }) => {
      const attributes = [
        idField,
      ]

      const whereClause = {
        [CustomerIdField]: customerId,
      }

      return {
        attributes,
        where: whereClause,
      }
    },
  })
}
```

**Advanced example** (two conditions, each with its own operator, single result):

```js
this.addSubquery({
  name: '?validFrom[<=].validUntil[>=].CouponId',
  generator: ({
    now,
  }) => {
    const attributes = [
      CouponIdField,
    ]

    const whereClause = {
      [validFromField]: {
        [SequelizeOp.lte]: now,
      },
      [validUntilField]: {
        [SequelizeOp.gte]: now,
      },
    }

    return {
      attributes,
      where: whereClause,
    }
  },
})
```

- The `Op` symbols come from the top of the model file:

```js
import {
  Op as SequelizeOp,
} from 'sequelize'
```

- **The name and the generator must agree.** Every `?` column in the name appears in `where`
  with exactly the operator its brackets declare; every `.` column appears in `attributes`.
  A name that says `[in]` while the generator assigns a direct value is a bug — the name is
  the contract.

## 4. Consume via `Model.subquery(name, params)` under `Op.in`

Call `Model.subquery(name, params)` — it returns a `Sequelize.Literal` — and drop it into a
`where` clause, almost always as the right-hand side of an `Op.in`. Typical resolver usage
(inside a `buildXxxWhereClause()` method, per `hor-query-resolver`):

```js
import {
  Op,
} from 'sequelize'

// ...

/**
 * Build where clause for shipments.
 *
 * @param {{
 *   tenantBrandId: number
 * }} params - Parameters.
 * @returns {object} Where clause.
 */
buildShipmentWhereClause ({
  tenantBrandId,
}) {
  const shipmentLatestStatusSubquery = ShipmentLatestStatus.subquery(
    '?ShipmentStatusId[in].ShipmentId',
    {
      shipmentStatusIds: [SHIPMENT_STATUS.READY_TO_SHIP.ID],
    }
  )

  const whereClause = {
    TenantBrandId: tenantBrandId,
    id: {
      [Op.in]: shipmentLatestStatusSubquery,
    },
  }

  return whereClause
}
```

Combining two subqueries on the same column uses `Op.and`:

```js
return {
  ...whereClause,
  id: {
    [Op.and]: [
      {
        [Op.in]: shipmentLatestStatusSubquery,
      },
      {
        [Op.in]: desiredDeliveryDateSubquery,
      },
    ],
  },
}
```

- Calling `Model.subquery(name, ...)` with a name that was never registered throws
  `invalid subquery ${name} called.` — the name string at the call site must match the
  registered name character for character.

## 5. Testing

Test the **generator**, not the SQL string. Pull it with
`Model.getSubqueryOptionsGenerator(name)`, invoke it with `params`, and assert the returned
`{ attributes, where }` with a single `toEqual`. The generator is pure (no DB access), so the
test needs no seeder and lives under `tests/__tests__/sequelize/models/` (per `hoc-jest` —
DB-writing tests are the ones that go elsewhere).

Structure: `describe('<Model>')` → `describe('.subquery')` → `describe('<subquery name>')` →
`test.each`. Import `Op` from `sequelize` so the expected `where` carries the real operator
symbols.

```js
import {
  Op,
} from 'sequelize'

import ShipmentLatestStatus from '../../../../sequelize/models/ShipmentLatestStatus.js'

describe('ShipmentLatestStatus', () => {
  describe('.subquery', () => {
    describe('?ShipmentStatusId[in].ShipmentId', () => {
      const cases = [
        {
          params: {
            shipmentStatusIds: [10001, 10002],
          },
          expected: {
            attributes: ['shipment_id'],
            where: {
              shipment_status_id: {
                [Op.in]: [10001, 10002],
              },
            },
          },
        },
        {
          params: {
            shipmentStatusIds: [10003],
          },
          expected: {
            attributes: ['shipment_id'],
            where: {
              shipment_status_id: {
                [Op.in]: [10003],
              },
            },
          },
        },
      ]

      test.each(cases)('shipmentStatusIds[0]: $params.shipmentStatusIds.0', ({
        params,
        expected,
      }) => {
        const generator = ShipmentLatestStatus.getSubqueryOptionsGenerator('?ShipmentStatusId[in].ShipmentId')

        const actual = generator(params)

        expect(actual)
          .toEqual(expected)
      })
    })
  })
})
```

Conventions to keep (details in `hoc-jest`):

- **`test.each`, prefer ≥ 2 cases** (vary the params); a trivial single-condition subquery may
  use one case. Vary exactly one `params` field in the title and keep it unique per case — dot
  into an array element as needed (`$params.shipmentStatusIds.0`).
- **Cases are `{ params, expected }`** — no other keys unless justified.
- **One `toEqual`** for the whole returned object; build the full `expected` (including `Op`
  symbols) and compare once.
- **AAA, no logic in the body** — arrange the generator, act by calling it, assert.
- The expected `attributes` / `where` keys are the **DB field names** (snake_case) — that is
  what the generator returns, and it verifies the attribute-to-field mapping too.
- Test a subquery against real seeded data only when exercising it end-to-end through a
  resolver that reads the DB — that is a resolver test, placed per `hoc-jest`'s directory rules.

## Finishing checklist

- [ ] Does the subquery live in `static defineSubqueries()` on the model that owns the condition columns, added via `this.addSubquery({ name, generator })` (no raw `Sequelize.literal` at call sites)?
- [ ] Does `defineSubqueries()` call `super.defineSubqueries?.()` first, and take field names from `this.getAttributes()` (no hard-coded snake_case strings)?
- [ ] Does the name follow `?<condition>[<operator>].<result>` — every `?` column in `where` with exactly the declared operator, every `.` column in `attributes`, no brackets for plain equality, and **no table name**?
- [ ] Does the generator return `{ attributes, where }` keyed by **DB field names**?
- [ ] Does the consumer call `Model.subquery(name, params)` under `Op.in` (with `Op.and` when combining two subqueries on the same column), with the name matching the registration exactly?
- [ ] Is the generator tested via `Model.getSubqueryOptionsGenerator(name)` with `test.each` `{ params, expected }` cases and a single `toEqual` (including the real `Op` symbols), placed under `tests/__tests__/sequelize/models/`?
