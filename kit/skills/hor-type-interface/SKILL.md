---
name: hor-type-interface
description: >
  Define TypeScript type interfaces in .d.ts declaration files: model interfaces (one file per
  model/table under types/models/, in the global `model` namespace) and resolver input/output
  types (all in types/graphql.d.ts, in the global `graphql.<category>` namespace, as
  <Resolver>Input and <Resolver>Result). Use this skill whenever the user asks to add or change a
  model interface, a resolver's Input/Result types, or another shared global type.
---

# Type Interface Definition

A skill for the **`.d.ts` type declarations** that describe an app's data shapes: the **model
interfaces** (one per table) and the **resolver input/output types** (a pair per resolver). Both
are declared as **ambient global namespaces**, so any JSDoc can reference them (`model.User`,
`graphql.user.CreateOrderInput`) without an import. Each model gets **its own file**, merged into
one namespace by TypeScript's declaration merging, and every resolver type lives in the one file
`types/graphql.d.ts`.

> This skill states a **general, project-independent rule** — a refined best practice, not a
> description of any one project's code, so it need not match a given repo's existing notation. The
> directory names, namespaces (`model`, `graphql.<category>`), and example type names (`User`,
> `Order`, `CreateOrderInput`, …) are the **recommended convention with illustrative fakes**; use your
> project's own model and resolver names and never bake its domain concepts or file paths into the
> rule.

## Grand principle: one file per model, one file for resolver types, all in global namespaces

Every model gets its **own `.d.ts` file**, and every resolver type goes into the single file
`types/graphql.d.ts`. Each file declares types into a **shared global namespace**. TypeScript's
**declaration merging** combines the same-named `namespace` blocks into one, so the split costs
nothing at the access site.

- **Why one file per model.** A monolithic `model.d.ts` is a constant merge-conflict point, because
  every model change touches the same file. Splitting to `types/models/<ModelName>.d.ts` means two
  changes collide **only when they touch the same model**. Adding a model = adding a file.
- **Why one file for resolver types.** A resolver's `Input` / `Result` pair mirrors the schema
  (SDL) one-to-one, so it is written in the same change as the SDL and read beside the other
  resolver types of its category. One file, `types/graphql.d.ts`, is the place to look, and there is
  no per-resolver path to keep in step with the resolver's own file name.
- **Why it still reads as one namespace.** `declare global { namespace model { … } }` in
  `User.d.ts` and the same block in `Order.d.ts` **merge** into a single `model` namespace. Consumers
  write `model.User` / `model.Order` regardless of which file declared them — the file split is
  invisible to readers.
- **Why global (ambient).** Declared under `declare global`, the types need **no import** to be used
  in a JSDoc annotation anywhere in the codebase. That is the point of the namespaces — a resolver's
  JSDoc just writes `@returns {Promise<graphql.user.CreateOrderResult>}`.
- **Wiring**: the project's `tsconfig` / `jsconfig` `include` must cover the `types/**` directory so
  these ambient declarations are picked up project-wide.

**Sample code follows the project's lint style**: `.d.ts` uses no semicolons, 2-space indent, and
interface members are one-per-line (no trailing comma or semicolon). Comments in the files you
generate are English for structural notes; domain notes match the surrounding language.

## 1. The `.d.ts` scaffold

Every declaration file has the same three-line envelope: an `export {}` module marker, then a
`declare global` block, then the `namespace`. The interfaces go inside the namespace.

```ts
export {}

declare global {
  namespace model {
    // interfaces here
  }
}
```

- **`export {}`** makes the file a module (so `declare global` is legal). It exports nothing itself.
- **`declare global { … }`** puts the namespace in the ambient global scope — visible everywhere with
  no import.
- The **namespace name is fixed by kind**: `model` for model interfaces ([§2](#2-model-interfaces-one-file-per-table)),
  `graphql.<category>` for resolver types ([§3](#3-resolver-inputoutput-types-in-typesgraphqldts)).

## 2. Model interfaces (one file per table)

A model interface maps **1:1 to a table**. Put each in its own file
`types/models/<ModelName>.d.ts`, declaring one interface `<ModelName>` into `namespace model`.

```ts
// types/models/User.d.ts
export {}

declare global {
  namespace model {
    interface User {
      id: number
      email: string
      displayName: string | null
      registeredAt: Date
      OrganizationId: number
    }
  }
}
```

```ts
// types/models/Order.d.ts — a second model, its own file, same namespace
export {}

declare global {
  namespace model {
    interface Order {
      id: number
      UserId: number
      totalAmount: number
      placedAt: Date
      canceledAt: Date | null
    }
  }
}
```

- **One interface per file**, named exactly for the model, so it is reachable as `model.User` /
  `model.Order`.
- **Fields mirror the table's columns.** Use the precise scalar type (`number` / `string` / `Date` /
  `boolean`); a nullable column is `<type> | null`.
- **A field holding another model's id starts with an uppercase initial** (`UserId`,
  `OrganizationId`), mirroring how the ORM's associations are named — this distinguishes a foreign-key
  field from a plain scalar at a glance.
- Optionally, a model interface may `extend` a framework base-model interface (if the architecture
  provides one for the common columns); keep that base generic, not a hard-coded app path.

## 3. Resolver input/output types (in `types/graphql.d.ts`)

Every resolver's types go into the one file `types/graphql.d.ts`, declared into
`namespace graphql.<category>`, where `<category>` is the API/endpoint group (`user`, `admin`,
`portal`, …). Each resolver declares its **`<Resolver>Input`** and its **`<Resolver>Result`** (the
output / response), written as a pair.

```ts
// types/graphql.d.ts
export {}

declare global {
  namespace graphql.user {
    interface CreateOrderInput {
      productId: number
      quantity: number
    }

    interface CreateOrderResult {
      order: model.Order
    }
  }

  namespace graphql.admin {
    interface OrdersInput {
      limit: number
      offset: number
    }

    interface OrdersResult {
      orders: model.Order[]
    }
  }
}
```

- **Input** is the resolver's argument shape; **Result** is what it returns (the response). A
  query uses the same `Input` / `Result` pairing.
- **One `namespace graphql.<category>` block per category**, inside the single `declare global`.
  Keep a resolver's `Input` and `Result` next to each other.
- **Reuse model interfaces in the output** — a Result field is typed as `model.<ModelName>`
  (`order: model.Order`). The `model` and `graphql.<category>` namespaces are both global, so one
  references the other with no import.
- **Resolver-local helper types** (a nested filter input, a row sub-shape) sit in the same block,
  beside the pair they belong to, named so they cannot collide with another resolver's.
- **Category = the resolver's endpoint group.** The same resolver name under a different endpoint is
  a different namespace (`graphql.user.FooInput` vs `graphql.admin.FooInput`), in the same file.

## 4. Accessing the types

Because the namespaces are global, JSDoc references them directly — no import:

```js
/**
 * @param {{
 *   variables: {
 *     input: graphql.user.CreateOrderInput
 *   }
 * }} params
 * @returns {Promise<graphql.user.CreateOrderResult>}
 */
async resolve ({
  variables: {
    input,
  },
}) {
  // input is typed as graphql.user.CreateOrderInput
}
```

- Model shapes are referenced the same way: `@param {model.User} user`.
- This global access is the reason the types are ambient — the split into many files never forces an
  import.

## 5. Naming & placement (quick reference)

| Kind | File | Namespace | Interface names | Access |
| --- | --- | --- | --- | --- |
| Model | `types/models/<ModelName>.d.ts` | `model` | `<ModelName>` | `model.<ModelName>` |
| Resolver | `types/graphql.d.ts` | `graphql.<category>` | `<Resolver>Input`, `<Resolver>Result` | `graphql.<category>.<Resolver>Input` |

- A model's file base name is `<ModelName>` (PascalCase); resolver types share the one file.
- Avoid the denied vague identifiers in field names (`data` / `info` / `list` / …); name a field for
  what it holds.

## Finishing checklist

- [ ] The type lives in the right file: one model → its own `types/models/<ModelName>.d.ts`; a resolver's types → `types/graphql.d.ts` ([§1](#1-the-dts-scaffold)).
- [ ] File envelope is `export {}` → `declare global` → the correct `namespace` (`model` or `graphql.<category>`).
- [ ] Model interface is 1:1 with a table; fields mirror columns; nullable is `| null`; a foreign-key field starts uppercase ([§2](#2-model-interfaces-one-file-per-table)).
- [ ] `types/graphql.d.ts` declares `<Resolver>Input` + `<Resolver>Result` in the resolver's `graphql.<category>` block, reuses `model.<ModelName>` in outputs, and keeps resolver-local helper types beside the pair ([§3](#3-resolver-inputoutput-types-in-typesgraphqldts)).
- [ ] The `types/**` directory is included in the project's TS config so the ambient declarations resolve.
