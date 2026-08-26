---
name: hor-stub-api
description: >
  Implement a stub GraphQL resolver: a query/mutation resolver that returns hardcoded,
  schema-accurate data with no DB access and no business logic, so the frontend can
  develop against the API contract before the real backend exists. Use this skill
  whenever the user asks to add or edit a stub resolver (a class under
  server/graphql/resolvers/<audience>/stub/), wants "a fake API the frontend can call
  now", or needs to migrate a finished stub into a real resolver under actual/.
---

# Stub API (schema-accurate stub resolvers)

A skill for implementing **stub resolvers**: query/mutation resolver classes that return hardcoded,
schema-accurate data. They exist so the frontend can build against the API contract while the real
backend logic is still unwritten. A stub lives under
`server/graphql/resolvers/<audience>/stub/{queries,mutations}/` (where `<audience>` is one of the
app's audience folders, e.g. `customer` / `admin`); the matching real resolver later lives under
`server/graphql/resolvers/<audience>/actual/…` with the **same class name and interface**.

The schema the stub must mirror is authored per `hor-graphql-schema`. The real implementation the stub
is eventually replaced by is authored per `hor-query-resolver` / `hor-mutation-resolver`; this skill covers
only the stub itself and the hand-off to the real resolver.

## Grand principle: a stub returns hardcoded literals only — no logic of any kind

Everything a stub's `resolve()` returns is a **hardcoded literal**. No DB access, no service calls,
no validation, no computation, no conditionals, no `map`/`filter`/`reduce` over input. The single
exception is the pagination slice ([2](#2-paginated-query-stub)).

- **Why literals only**: a stub's job is to pin down the **contract** (the response shape), not to
  approximate the behavior. Any logic you write in a stub is unverified pseudo-implementation — it
  can drift from the real rules, the frontend starts depending on it, and the divergence shows up
  as breakage at migration time. A literal cannot lie about anything except the shape, and the
  shape is exactly what a stub exists to guarantee.
- **Why schema-accurate**: the returned shape must match the GraphQL schema exactly (every required
  field present, correct types). A stub that omits fields forces the frontend to discover the gap
  against the real API later — the one failure mode a stub is supposed to prevent.
- **Echo input back only where the schema result mirrors it** (e.g. a mutation that returns the id
  it was given); otherwise return plausible hardcoded ids/values. Echoing is reading a field, not
  computing — transforming input is already logic and belongs to the real resolver.

```js
// Good: every field is a hardcoded literal — the stub pins the shape and nothing else
/** @override */
async resolve ({
  variables: {
    input,
  },
  context,
}) {
  return {
    shippingAddressId: 1003,
  }
}
```

```js
// Avoid: computing values from input in a stub
//   → unverified pseudo-logic the frontend starts depending on; it drifts from the real rules and breaks at migration time
async resolve ({
  variables: {
    input,
  },
}) {
  const normalizedCode = input.postalCode.replace('-', '') // computation — belongs to the real resolver
  return {
    shippingAddressId: normalizedCode.length > 0
      ? 1003
      : null, // conditional — a stub never branches
  }
}
```

## 1. Query stub

Extend `BaseQueryResolver`. `schema` is a **`static get`** returning the camelCase GraphQL
operation name. `resolve()` destructures `{ variables: { input }, context }` and returns literals.

```js
import {
  BaseQueryResolver,
} from '@openreachtech/renchan'

/**
 * Stub resolver: shippingCarriers query.
 *
 * @extends {BaseQueryResolver}
 */
export default class ShippingCarriersQueryResolver extends BaseQueryResolver {
  /**
   * get: Operation name.
   *
   * @override
   * @returns {string}
   */
  static get schema () {
    return 'shippingCarriers'
  }

  /**
   * Resolve. Returns hardcoded, schema-accurate data.
   *
   * @override
   */
  async resolve ({
    variables: {
      input: {
        searchParameters,
      },
    },
    context,
  }) {
    const allCarriers = [
      {
        shippingCarrierId: 1,
        shippingCarrierName: 'Alpha Express',
        shippingCarrierCode: 'ALPHA',
      },
      {
        shippingCarrierId: 2,
        shippingCarrierName: 'Beta Logistics',
        shippingCarrierCode: 'BETA',
      },
    ]

    return {
      shippingCarriers: allCarriers,
    }
  }
}
```

- If the query takes no input, drop the `input` destructuring and keep just `resolve ()` or
  `resolve ({ context })`.
- The file name is `<Operation>QueryResolver.js`, matching the class name.

## 2. Paginated query stub

When the query is paginated (`input.pagination` with `limit` / `offset` / `sort`), hardcode a full
`const all<Things>` array of **at least 10 records** (every value unique), then return the correct
page. The slice below is the **only** operation the whole stub is allowed to do.

```js
import {
  BaseQueryResolver,
} from '@openreachtech/renchan'

/**
 * Stub resolver: customerBillingHistories query (paginated).
 *
 * @extends {BaseQueryResolver}
 */
export default class CustomerBillingHistoriesQueryResolver extends BaseQueryResolver {
  /**
   * get: Operation name.
   *
   * @override
   * @returns {string}
   */
  static get schema () {
    return 'customerBillingHistories'
  }

  /**
   * Resolve. Returns the requested page of hardcoded records.
   *
   * @override
   */
  async resolve ({
    variables: {
      input: {
        pagination: {
          limit,
          offset,
          sort,
        },
      },
    },
  }) {
    const allBillingHistories = [
      {
        orderPaymentId: 50001,
        totalPrice: '5450.00',
        paidAt: new Date('2024-01-18T14:00:00.000Z'),
        // ... the rest of the schema-required fields, all hardcoded
      },
      // ... at least 10 hardcoded records total, every value unique
    ]

    const totalRecords = allBillingHistories.length
    const billingHistories = allBillingHistories.slice(offset, offset + limit)

    return {
      billingHistories,
      pagination: {
        limit,
        offset,
        sort,
        totalRecords,
      },
    }
  }
}
```

- **Use `slice(offset, offset + limit)`** — it returns a copy of the requested page. Do **not** use
  `splice`, which mutates the source array.
- `totalRecords` is the array's `.length` (never a hardcoded number), so the page math stays
  correct as records are added.
- Hardcode **at least 10 records with every value unique**, so the frontend can see paging actually
  advance and distinguish the records on screen.
- This slice + `.length` is the only computation permitted; every field inside the records is a
  hardcoded literal.

## 3. Mutation stub

Extend `BaseMutationResolver`. Same **`static get schema ()`**, plus a
**`static get errorCodeHash ()`** that spreads `super.errorCodeHash`. Stubs keep the hash empty —
real error codes are added during migration ([4](#4-migrating-a-stub-to-a-real-resolver)).

```js
import {
  BaseMutationResolver,
} from '@openreachtech/renchan'

/**
 * Stub resolver: addShippingAddress mutation.
 *
 * @extends {BaseMutationResolver}
 */
export default class AddShippingAddressMutationResolver extends BaseMutationResolver {
  /**
   * get: Operation name.
   *
   * @override
   * @returns {string}
   */
  static get schema () {
    return 'addShippingAddress'
  }

  /**
   * get: Error code hash. Kept empty in a stub.
   *
   * @override
   * @returns {Record<string, string>}
   */
  static get errorCodeHash () {
    return {
      ...super.errorCodeHash,
    }
  }

  /**
   * Resolve. Returns hardcoded, schema-accurate data.
   *
   * @override
   */
  async resolve ({
    variables: {
      input,
    },
    context,
  }) {
    return {
      shippingAddressId: 1003,
    }
  }
}
```

Echo input back when the result mirrors it — destructure exactly the fields you return:

```js
/** @override */
async resolve ({
  variables: {
    input: {
      originObjectCategoryId,
      originObjectUniqueKey,
    },
  },
  context,
}) {
  return {
    originObjectCategoryId,
    originObjectUniqueKey,
    updatedColumnsWithValues: [],
  }
}
```

## 4. Migrating a stub to a real resolver

Preserve the interface, swap only the body. The frontend must not notice the switch except that
the data becomes real.

1. **Keep the class name, `static get schema ()`, and `static get errorCodeHash ()`.** Move the
   file from `…/stub/…` to `…/actual/…`.
2. **Fill `errorCodeHash` with real codes** (spread `super.errorCodeHash` first):

   ```js
   /** @override */
   static get errorCodeHash () {
     return {
       ...super.errorCodeHash,

       InvalidPostalCode: '203.M004.001',
       InvalidPrefecture: '203.M004.002',
     }
   }
   ```
3. **Replace the literal return with real work** — validate input, run DB/transaction logic through
   Sequelize models, and format the response with **the same shape the stub returned**. Structure
   the real resolver per `hor-query-resolver` / `hor-mutation-resolver` (extracted `validateInput` /
   transaction callback / `formatResponse` — not everything inlined in `resolve()`).
4. Throwing an error-code key surfaces it via `errorCodeHash` — this is where the codes added in
   step 2 come into play.

## Finishing checklist

- [ ] Is every returned field a **hardcoded literal** (no DB, no service calls, no validation, no conditionals, no `map`/`filter`/`reduce`)?
- [ ] Does the returned shape match the GraphQL schema **exactly** (all required fields, correct types)?
- [ ] Is the file under `server/graphql/resolvers/<audience>/stub/{queries,mutations}/`, with class name `<Operation>QueryResolver` / `<Operation>MutationResolver` and a matching file name?
- [ ] Does `static get schema ()` return the camelCase operation name?
- [ ] Does a mutation stub define `static get errorCodeHash ()` spreading `super.errorCodeHash`, kept empty?
- [ ] Paginated stub: ≥ 10 hardcoded records with unique values, page via `slice(offset, offset + limit)` (never `splice`), `totalRecords` = array `.length`?
- [ ] Is input echoed back only where the schema result mirrors it (no transformation of input)?
- [ ] When migrating: same class name / `schema` / `errorCodeHash` interface, file moved to `actual/`, real codes filled in, response shape unchanged?
