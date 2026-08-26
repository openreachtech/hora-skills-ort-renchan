---
name: hor-graphql-schema
description: >
  Author and edit GraphQL SDL (.graphql) files for a renchan server: per-audience schemas loaded
  via each engine's schemaPath, numbered per-domain files, custom scalars, and the conventions for
  type and field naming, nullability, enums and pagination. Use this skill whenever the user asks
  to add or change a GraphQL schema — a new operation, a new type, a new domain file, a scalar, an
  enum, pagination or sort types — or asks where an SDL definition belongs or what to name a field.
---

# GraphQL Schema (SDL conventions)

A skill for writing the `.graphql` SDL files that define each audience's GraphQL contract.
The SDL declares the shape; the behavior behind each field is implemented by
`hor-query-resolver` / `hor-mutation-resolver`, and input values are checked by
`hor-resolver-validator`. This skill covers where an SDL definition goes, how it is named, and
how its fields are typed.

## Grand principle: the SDL is a derived contract — names, nullability, and placement follow mechanical rules, not taste

Every schema decision in this convention can be derived: the operation name drives the
type names one-to-one (`<Operation>Input` / `<Operation>Result`), non-null `!` is the
default unless a value is genuinely optional, each business domain gets its own numbered
file, and each audience keeps its own schema. **Do not invent ad-hoc names,
nullable-by-default fields, or a shared "misc" file** — a reader who knows the operation
name must be able to predict the file, the type names, and the nullability without opening
anything.

- **Why mechanical naming**: resolvers are matched to operations by name
  (`static get schema()` in `hor-query-resolver` / `hor-mutation-resolver` returns the SDL field
  name), and JSDoc types reference `<Operation>Input` / `<Operation>Result` directly. One
  mismatched name breaks the chain from SDL to resolver to type-check.
- **Why non-null by default**: a nullable field forces every consumer to write a null
  branch. Reserving nullability for genuinely optional values makes each remaining `?`
  meaningful — nullability becomes documentation, not noise.
- **Why per-audience, per-domain files**: audiences (e.g. customer / admin) have different
  contracts and lifecycles. Merging them, or piling domains into one file, makes it
  impossible to see which audience a change affects.

```graphql
# Good: names derived from the operation, non-null by default, deliberate nullability
type Query {
  orders(input: OrdersInput!): OrdersResult!
}

input OrdersInput {
  pagination: PaginationInput!
  filters: OrderFiltersInput   # nullable: filters are genuinely optional
}

type OrdersResult {
  orders: [OrderSummary!]!
  pagination: Pagination!
}
```

```graphql
# Avoid: invented payload name, nullable-by-default fields
#   → the resolver/type chain can no longer be predicted from the operation name,
#     and every consumer must null-check fields that are never actually null.
type Query {
  orders(input: OrdersArgs): OrdersPayload
}

type OrdersPayload {
  orders: [OrderSummary]
  pagination: Pagination
}
```

## 1. Where a schema lives and how it loads (check the engine first)

Each audience is loaded by its own `*GraphqlServerEngine.js`, and **how the schema is
loaded can differ by audience**. Before adding or editing a file, check that audience's
engine `schemaPath`:

- **Folder path** (e.g. `server/graphql/schemas/customer/`) → the folder's numbered files
  are merged into one schema at load time. Follow the numbered-file conventions below.
- **Single file path** (e.g. `server/graphql/schemas/admin.graphql`) → edit that one file.
  A sibling folder of the same audience name may exist but be **unwired** — adding files
  there changes nothing until the engine's `schemaPath` points at it.

```js
// server/graphql/CustomerGraphqlServerEngine.js — the source of truth for what loads
static get config () {
  return {
    // ...existing config...
    schemaPath: rootPath.to('server/graphql/schemas/customer/'),
  }
}
```

- **Never put a type for one audience in another audience's folder.** Even identical-looking
  types (e.g. `Pagination`) are declared per audience, because the audiences' contracts
  evolve independently.

## 2. File organization — numbered, per-domain

A merged-folder audience is split into numbered per-domain files. The first file
(`001-common.graphql`) holds shared plumbing (scalars, `Pagination`, `Sort`, shared enums);
every later file is one business domain.

```
server/graphql/schemas/customer/
  001-common.graphql          # scalars, Pagination, Sort, shared enums
  002-auth.graphql
  003-order.graphql
  004-billing.graphql
```

- Filename is `NNN-<domain>.graphql`. Domain casing (kebab-case vs camelCase) can vary
  between existing files — **match the casing of the sibling files** in the folder you are
  editing.
- **One domain per file.** Add a new numbered file for a new domain rather than growing an
  existing one.
- All files in the folder are merged at load time, so `type Query` / `type Mutation` may be
  declared in several files ([4](#4-query--mutation-blocks--colocated-per-domain-file)).

## 3. Custom scalars — declared once, at the top of the common file

Custom scalars are declared **only** in that audience's `001-common.graphql`, at the very
top, one per line, no `!`:

```graphql
scalar BigNumber
scalar DateTime
scalar Upload
```

- Do not re-declare a scalar in any other file. Just reference it (`createdAt: DateTime!`).
- Scalars can differ across audiences — declare only the scalars the audience uses,
  matching the sibling audiences' style rather than copying their scalar list.

## 4. Query / Mutation blocks — colocated per domain file

Do **not** keep one giant root `Query` / `Mutation`. Each domain file opens its own
`type Query` and `type Mutation` block listing only that domain's fields; the loader merges
them.

```graphql
# 003-order.graphql
type Query {
  orders(input: OrdersInput!): OrdersResult!
  orderDetail(input: OrderDetailInput!): OrderDetailResult!
}

type Mutation {
  cancelOrder(input: CancelOrderInput!): CancelOrderResult!
  archiveDeliveredOrders: ArchiveDeliveredOrdersResult!
}
```

- A field with no input takes no argument (`archiveDeliveredOrders: ArchiveDeliveredOrdersResult!`).
- Every operation returns a non-null payload type (`...Result!`).

## 5. Type naming — `<Operation>Input` and `<Operation>Result`

The operation name drives the type names, one-to-one:

| Kind | Name | Example |
| --- | --- | --- |
| Input | `<Operation>Input` | `cancelOrder` → `CancelOrderInput` |
| Payload | `<Operation>Result` | `orders` → `OrdersResult` |

- Nested / domain object types are plain nouns (`OrderItem`, `ProductImage`, `Status`).
- Sub-summary types carry a `Summary` suffix (`OrderSummary`).
- One operation, one input type, one result type — do not share an input or result type
  between operations even when the shapes currently coincide; shared types couple
  operations that will diverge.

## 5.1 Field naming — the SDL borrows the database's vocabulary

The SDL does not invent a second vocabulary. A field carries the same name as the column it
exposes, so renaming a concept is one change across the migration, the model, and the schema.

- Datetime fields end with `At`; date-only fields end with `On`. A range keeps the suffix and
  adds `From` / `To` (`modifiedAtFrom` / `modifiedAtTo`).
- **Never expose `updatedAt` / `createdAt`.** They read as the ORM's audit columns, whose timing
  is a framework detail the application does not own — a migration backfill moves them without any
  business event. A business time is its own named field: `modifiedAt`, `generatedAt`,
  `registeredAt`. This is the SDL side of the business-time-vs-audit-time split the database
  design convention enforces on the column side.
- A classification field is `xxxCategory`, not `xxxType` — `type` collides with the JSDoc type
  annotation, so a reader cannot tell whether it means a JavaScript type or a business
  classification. The shared naming convention lists the one exception: a word borrowed verbatim
  from an external standard (`mimeType`).
- A `sort.targetColumn` allow-list uses these same field names, so renaming a field renames the
  sort key in the same change.
- **A single-character key is prohibited** — in a field, an argument, or an input type. `q`, `s`,
  `n`, `p` state nothing about what the value is; name the key for what it holds (`searchQuery`,
  `sortKey`, `pageNumber`). The SDL is the contract every client reads *before* it reads any code,
  so a one-letter key costs every consumer a trip into the resolver to learn what to pass, and the
  generated TypeScript type inherits the same opaque name. Abbreviations are limited to the shared
  naming convention's whitelist, and no single letter is on it.

```graphql
# Good: the key states what the value is
input SearchArticlesInput {
  searchQuery: String!
  sortKey: String!
}

# Avoid: single-character keys — the contract no longer explains itself
input SearchArticlesInput {
  q: String!
  s: String!
}
```

## 6. Non-null `!` — the default

`!` is applied to nearly every field and argument. A field is non-null unless the value is
**genuinely optional**; nullability is deliberate, not the fallback.

```graphql
type Order {
  id: Int!
  customerId: Int              # nullable: guest orders have no customer
  items: [OrderItem!]!         # non-null list of non-null elements
  modifiedAt: DateTime!
}
```

- Lists are `[T!]!` when the list is required; use `[T!]` only when the whole list is
  genuinely optional.
- Optional inputs drop the `!` and carry a short comment stating why the null is allowed
  (`avatarUrl: String # allow null`).
- SDL `!` only guards *presence*. Value-level checks (ranges, formats, enum membership)
  belong to the `hor-resolver-validator` skill — do not weaken the SDL to "validate later",
  and do not assume `!` makes a validator unnecessary.

## 7. Money / decimal fields — `String!`, decimal-as-string

Money and decimal amounts are typed **`String!`** — not `Float` (loses precision) and not
`BigNumber` (reserved for non-money large integers such as byte sizes). Resolvers emit them
via `BigNumber#toFixed(2)`.

```graphql
type OrderItem {
  quantity: Int!
  unitPrice: String! # Decimal as string for precision
  totalPrice: String!
}
```

```js
// Resolver side: emit decimals as fixed strings
return {
  unitPrice: orderItem.unitPrice.toFixed(2),
  totalPrice: orderItem.totalPrice.toFixed(2),
}
```

```graphql
# Avoid: Float for money → binary floating point corrupts amounts like 0.1 + 0.2
type OrderItem {
  totalPrice: Float!
}
```

## 8. Pagination type shape

A list query returns its rows plus a `Pagination` object; the input carries a
`PaginationInput`. Both live in `001-common.graphql`.

```graphql
type Pagination {
  limit: Int!
  offset: Int!
  sort: Sort
  totalRecords: Int!
}

input PaginationInput {
  limit: Int!
  offset: Int!
  sort: SortInput
}

type OrdersResult {
  orders: [OrderSummary!]!
  pagination: Pagination!
}

input OrdersInput {
  pagination: PaginationInput!
  filters: OrderFiltersInput   # optional filters
}
```

- `sort` / `SortInput` are **nullable** on the pagination pair; `limit` / `offset` /
  `totalRecords` are non-null.
- The `Sort` shape can differ across audiences — match the pagination/sort types already
  used in the audience folder you are editing; never copy one audience's shape into
  another.
- Enums for filters/sort live in the domain file that uses them, or in `001-common` when
  shared.
- Validation of `limit` / `offset` / `sort` values on the resolver side is covered by the
  shared pagination validator in `hor-resolver-validator`.
- Enums are written **one member per line**, never inline — an inline enum has nowhere to put
  the per-member comment that explains what the value means, and every added member re-diffs
  the whole line.

```graphql
# Good
enum SortDirection {
  ASC
  DESC
}

# Avoid
enum SortDirection { ASC DESC }
```

## 9. Mirror every SDL type into `types/<Audience>GraphQL.d.ts`

Defining a type in the SDL is **only half the job** — declare the matching TypeScript
interface in the audience's `types/<Audience>GraphQL.d.ts` in the same change. Resolvers
reference these via JSDoc
(`@param {{ input: server.graphql.customer.CancelOrderInput }}`,
`@returns {Promise<server.graphql.customer.OrdersResult>}`), so a type present in
the SDL but missing from the `.d.ts` fails type-check.

```typescript
declare global {
  namespace server.graphql.customer {
    interface CancelOrderInput {
      orderId: number
    }

    interface CancelOrderResult {
      canceledOrderId: number
    }
  }
}
```

- Name the interfaces exactly `<Operation>Input` / `<Operation>Result`.
- Keep fields in sync field-for-field: GraphQL `!` → required property, nullable → `?`.

## 10. Match the surrounding file's style

Section banners and member ordering are per-audience habits, not one global rule — some
folders use light banners (`# ===== Order Mutation Input Types =====`), others use full
`#### QUERY` / `#### MUTATION` / `#### TYPE` / `#### INPUT` blocks with dictionary-order
rules stated in a header comment. **Follow whichever style the surrounding file already
uses**, including any stated ordering rule.

## Finishing checklist

- [ ] Did you check the audience engine's `schemaPath` before adding a file (merged folder vs single file, and is the folder actually wired)?
- [ ] Is the definition in the right audience and the right numbered domain file (new domain → new `NNN-<domain>.graphql`, casing matched to siblings)?
- [ ] Are custom scalars declared only once, at the top of that audience's `001-common.graphql`?
- [ ] Are the domain's `type Query` / `type Mutation` blocks colocated in the domain file (no giant root block)?
- [ ] Are the type names exactly `<Operation>Input` / `<Operation>Result`, with plain-noun object types and `Summary` sub-types?
- [ ] Is `!` the default, with every nullable field genuinely optional (and commented why)? Lists `[T!]!` unless the whole list is optional?
- [ ] Are money/decimal fields `String!` (emitted via `toFixed(2)`), with `BigNumber` reserved for non-money large integers?
- [ ] Do list operations use the audience's `Pagination` / `PaginationInput` shape (nullable `sort`, non-null `limit`/`offset`/`totalRecords`)?
- [ ] Did you mirror every added/changed SDL type into `types/<Audience>GraphQL.d.ts`, field-for-field, in the same change?
- [ ] Did you match the surrounding file's banner style and any stated ordering rule?
