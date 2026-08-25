---
name: hb-type-interface
description: >
  Define TypeScript type interfaces in .d.ts declaration files: model interfaces (one file per
  model/table under types/models/, in the global `model` namespace) and resolver input/output
  types (one file per resolver under types/resolvers/<category>/, in the global
  `graphql.<category>` namespace, as <Resolver>Input and <Resolver>Result). Use this skill
  whenever the user asks to add or change a model interface, a resolver's Input/Result types, or
  another shared global type.
---

# Type Interface Definition

A skill for the **`.d.ts` type declarations** that describe an app's data shapes: the **model
interfaces** (one per table) and the **resolver input/output types** (one per resolver). Both are
declared as **ambient global namespaces**, so any JSDoc can reference them (`model.User`,
`graphql.user.CreateOrderInput`) without an import. The core rule is **one file per entity** — one
model, one resolver — merged into a single namespace by TypeScript's declaration merging.

> This skill states a **general, project-independent rule** — a refined best practice, not a
> description of any one project's code, so it need not match a given repo's existing notation. The
> directory names, namespaces (`model`, `graphql.<category>`), and example type names (`User`,
> `Order`, `CreateOrderInput`, …) are the **recommended convention with illustrative fakes**; use your
> project's own model and resolver names and never bake its domain concepts or file paths into the
> rule.

## Grand principle: one file per entity, merged into one global namespace

Every model and every resolver gets its **own `.d.ts` file**, each declaring types into a **shared
global namespace**. TypeScript's **declaration merging** combines the same-named `namespace` blocks
from every file into one, so the split costs nothing at the access site.

- **Why one file per entity.** A monolithic `model.d.ts` / `graphql.d.ts` is a constant merge-conflict
  point — every model or resolver change touches the same file. Splitting to `types/models/<ModelName>.d.ts`
  and `types/resolvers/<category>/<resolverName>.d.ts` means two changes collide **only when they
  touch the same entity**. Adding a model = adding a file.
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
  `graphql.<category>` for resolver types ([§3](#3-resolver-inputoutput-types-one-file-per-resolver)).

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

## 3. Resolver input/output types (one file per resolver)

A resolver's types map **1:1 to the resolver**. Put them in
`types/resolvers/<category>/<resolverName>.d.ts`, declaring into `namespace graphql.<category>` —
where `<category>` is the API/endpoint group (`user`, `admin`, `portal`, …). Each resolver declares
its **`<Resolver>Input`** and its **`<Resolver>Result`** (the output / response).

```ts
// types/resolvers/user/createOrder.d.ts
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
}
```

- **Input** is the resolver's argument shape; **Result** is what it returns (the response). A
  query uses the same `Input` / `Result` pairing.
- **Reuse model interfaces in the output** — a Result field is typed as `model.<ModelName>`
  (`order: model.Order`). The `model` and `graphql.<category>` namespaces are both global, so one
  references the other with no import.
- **Resolver-local helper types** (a nested filter input, a row sub-shape) live in the **same file**
  as the resolver they belong to — they are part of that resolver's 1:1 slice, not shared globals.
- **Category = the resolver's endpoint group.** The same resolver name under a different endpoint is a
  different file and a different namespace (`graphql.user.FooInput` vs `graphql.admin.FooInput`).

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
| Resolver | `types/resolvers/<category>/<resolverName>.d.ts` | `graphql.<category>` | `<Resolver>Input`, `<Resolver>Result` | `graphql.<category>.<Resolver>Input` |

- File base names match the entity: `<ModelName>` (PascalCase) for models, `<resolverName>`
  (matching the resolver, camelCase) for resolvers.
- Avoid the denied vague identifiers in field names (`data` / `info` / `list` / …); name a field for
  what it holds.

## Finishing checklist

- [ ] The type lives in its **own file** — one model → `types/models/<ModelName>.d.ts`; one resolver → `types/resolvers/<category>/<resolverName>.d.ts` ([§1](#1-the-dts-scaffold)).
- [ ] File envelope is `export {}` → `declare global` → the correct `namespace` (`model` or `graphql.<category>`).
- [ ] Model interface is 1:1 with a table; fields mirror columns; nullable is `| null`; a foreign-key field starts uppercase ([§2](#2-model-interfaces-one-file-per-table)).
- [ ] Resolver file declares `<Resolver>Input` + `<Resolver>Result`, reuses `model.<ModelName>` in outputs, and keeps resolver-local helper types in the same file ([§3](#3-resolver-inputoutput-types-one-file-per-resolver)).
- [ ] The `types/**` directory is included in the project's TS config so the ambient declarations resolve.
