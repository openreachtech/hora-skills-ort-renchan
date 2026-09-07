# Errors, context, and actual-vs-stub

The errorCodeHash prefix families, the validator↔errorHash contract, domain-error creators, reading
auth and injected providers off `context`, and the actual-vs-stub split. Referenced from §1 and §4 of
[SKILL.md](../SKILL.md).

> The `users` / `User` / `Department` names and the `Q001` / `Q002` identifiers are placeholders —
> swap in your resource and this resolver's own identifier.

## errorCodeHash: families and identifiers

`errorCodeHash` maps each error **name** to a **string code**; the framework's `create()` turns those
into the `this.errorHash.<Name>` constructors the resolver and its validator throw. Always spread
`...super.errorCodeHash` first, then group this resolver's codes with a one-line family comment.

```js
/** @override */
static get errorCodeHash () {
  return {
    ...super.errorCodeHash,

    // Invalid Input Errors (203 prefix)
    InvalidUserId: '203.Q002.001',
    InvalidDepartmentId: '203.Q002.002',

    // Database Errors (204 prefix)
    UserNotFound: '204.Q002.001',
    DepartmentNotFound: '204.Q002.002',
  }
}
```

Code format is `<family>.<identifier>.<seq>`:

- **`<family>`** — the leading number classifies the error:
  - `203` — invalid input (raised by the `*InputValidator`).
  - `204` — database / not-found (thrown from `resolve()`).
  - `205` — business logic / external API.
  - Framework standards sit above these and are already defined by the engine — do **not** redeclare
    them: `102` unauthenticated / unauthorized / denied-permission, `104` database, `100` unknown,
    `101` concrete-member-not-found.
- **`<identifier>`** (`Q002`, …) is a **stable per-query id**. Keep one resolver on one identifier;
  the letter tracks the endpoint family (`Q` for the query endpoints).
- **`<seq>`** (`001`, `002`, …) numbers the errors within this resolver, per family.

## The validator ↔ errorHash contract

Input-shape errors are **not** thrown by the resolver directly — the `*InputValidator` raises them
through the **same `errorHash`** the resolver passes in. So every `InvalidXxx` the validator can raise
must have a matching key in the resolver's `errorCodeHash`.

- The resolver's `createInputValidator()` forwards `errorHash = this.errorHash`
  ([SKILL.md §5](../SKILL.md)); the validator's `ErrorHash` typedef lists those same `InvalidXxx`
  names (`hor-resolver-validator`).
- `validateInput()` returns the error or `null`; `resolve()` decides to throw. Keeping the throw in
  `resolve()` (not the validator) keeps the entrypoint's control flow visible.

## Domain errors: throw from resolve(), optionally via a creator

Not-found and empty-result errors are thrown where they are detected — right after the finder — with
`this.errorHash.<Name>.create()`:

```js
const user = await this.findUser({ userId })

if (!user) {
  throw this.errorHash.UserNotFound.create()
}
```

- **Never wrap the read/throw in `try/catch`.** The GraphQL layer maps a thrown declared error to the
  response; a `try/catch` that swallows or re-wraps it hides which code the caller receives. Let the
  declared error propagate.

When a resolver throws several domain errors, wrap each in a **creator method** so `resolve()` stays
readable and the construction is unit-testable. Creators sit at the bottom of the class (after
`formatResponse`) and default `errorHash` to `this.errorHash`:

```js
if (users.length === 0) {
  throw this.createUserNotFoundError()
}

// ... lower in the class ...

/**
 * Create a UserNotFoundError instance.
 *
 * @param {{
 *   errorHash?: ErrorHash
 * }} [params]
 * @returns {InstanceType<RenchanGraphqlErrorCtor>}
 */
createUserNotFoundError ({
  errorHash = this.errorHash,
} = {}) {
  return errorHash.UserNotFound.create()
}
```

## Reading context (auth + injected providers)

`resolve()` receives `{ variables, context, information, parent }`. **`context`** carries the
authenticated principal and request-scoped providers the engine injects. Destructure only what you
use; omit `context` entirely when the query needs nothing from it.

```js
async resolve ({
  context,
}) {
  const roleIds = context.employee.EmployeeRoleAssignments
    .map(employeeRoleAssignment => employeeRoleAssignment.RoleId)

  // ...
}
```

```js
async resolve ({
  variables: {
    input,
  },
  context: {
    modelProvider,          // an injected provider, destructured directly
  },
}) {
  // ... use modelProvider ...
}
```

- The principal lives under the endpoint's name: `context.user` (user endpoint), `context.customer`
  (customer endpoint), `context.employee` (admin endpoint), etc. — with its associations preloaded
  (e.g. `context.employee.EmployeeRoleAssignments`).
- Request-scoped providers the engine injects also live on `context`.
- **Authentication/authorization is enforced by the engine before `resolve()` runs** (the `102`
  standard codes). Do not re-check auth here; just read the trusted principal.
- Alias the context type in the typedef block:
  `@typedef {import('../../../../contexts/AdminGraphqlContext.js').default} AdminGraphqlContext`, and
  reference it from the `resolve()` param JSDoc.

## Actual vs stub

Every endpoint has parallel `actual/` and `stub/` trees; the engine wires each via
`actualResolversPath` / `stubResolversPath`.

- **`actual/queries/`** — the real resolver: validate, read the DB, throw domain errors, format. This
  is what this skill describes.
- **`stub/queries/`** — a same-`schema` resolver returning **fixed fake data** so the frontend can
  build against the contract before the real query exists. Stubs skip validation and the DB, often
  `await sleep(...)` to mimic latency, and return literal objects:

  ```js
  export default class UserSummaryQueryResolver extends BaseQueryResolver {
    /** @override */
    static get schema () {
      return 'userSummary'
    }

    /** @override */
    async resolve () {
      await sleep(200)

      return {
        totalUsers: 1234,
        activeUsers: 987,
      }
    }
  }
  ```

- A stub and its actual share the `schema` name and the GraphQL result shape; only the body differs.
  Keep stub data **obviously fake** so it is never mistaken for real output.
