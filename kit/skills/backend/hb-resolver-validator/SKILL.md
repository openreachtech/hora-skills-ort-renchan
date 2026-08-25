---
name: hb-resolver-validator
description: >
  Implement input-validation classes for GraphQL resolvers under
  app/validator/forResolver/<endpoint>/{queries,mutations}/, extending BaseInputValidator and
  delegating value checks to @openreachtech/mentsu-value-inspector. Use this skill whenever the
  user asks to validate a resolver's input — presence, number, integer, pagination, enum/keyword
  checks — via a `*InputValidator` class whose failing predicate raises the matching InvalidXxx
  error.
---

# Resolver Validator

A skill for writing the **`*InputValidator` classes** that GraphQL resolvers use to reject bad
input. A validator **extends `BaseInputValidator`** and declares a list of
`[predicate, ErrorConstructor]` entries; the base runs them and, for the first predicate that
returns `false`, raises that entry's error. Per-value checks (presence / number / integer /
positive-integer …) are delegated to **`@openreachtech/mentsu-value-inspector`**, imported directly
(it is a published module — use it from the package, not a local wrapper).

> Directory layout differs from the current repo on purpose — this is the target convention. The
> support classes (`BaseInputValidator`, `NormalPaginationInputValidator`) come from the renchan
> framework / shared layer; the inspectors come from the `@openreachtech/mentsu-value-inspector`
> module.

## Grand principle: declare `[predicate, error]` entries, let the base run them

A validator is a `BaseInputValidator` subclass whose only required override is
**`generateValidationEntries()`** — it returns `Array<[() => boolean, RenchanGraphqlErrorCtor]>`.
Each entry pairs a **predicate** (returns `true` when that rule passes) with the **error
constructor** to raise when it fails. The base holds `this.input` and `this.errorHash`, iterates the
entries, and throws the error of the first failing predicate.

- **Predicates are small `isValidX()` methods** that read `this.input` and return a boolean. They
  use the inspector classes and/or composed sub-validators — they never throw.
- **Errors come from `this.errorHash`** (the resolver's error hash, injected into the validator), so
  each `InvalidXxx` maps to the resolver's `errorCodeHash` code.
- **Reuse shared validators** (e.g. pagination) by composing them inside entries, not by
  re-implementing limit/offset/sort.

```js
import {
  IntegerValueInspector,
} from '@openreachtech/mentsu-value-inspector'

import BaseInputValidator from '../../BaseInputValidator.js'
import PaginationInputValidator from '../../NormalPaginationInputValidator.js'

const VALID_SORT_COLUMNS = [
  'labelName',
  'fieldPath',
]

/**
 * Class for validating input of the emailInsertableVariables query
 *
 * @extends {BaseInputValidator<ErrorHash, EmailInsertableVariablesInput>}
 */
export default class EmailInsertableVariablesInputValidator extends BaseInputValidator {
  /**
   * Generate validation entries
   *
   * @override
   * @returns {Array<[() => boolean, RenchanGraphqlErrorCtor]>}
   */
  generateValidationEntries () {
    const paginationInputValidator = this.createPaginationInputValidator()

    return [
      [
        () => paginationInputValidator.isValidLimit(),
        this.errorHash.InvalidPaginationLimit,
      ],
      [
        () => paginationInputValidator.isValidOffset(),
        this.errorHash.InvalidPaginationOffset,
      ],
      [
        () => paginationInputValidator.isValidSort(),
        this.errorHash.InvalidPaginationSort,
      ],
      [
        () => this.isValidKeyword(),
        this.errorHash.InvalidKeyword,
      ],
      [
        () => this.isValidOriginObjectCategoryId(),
        this.errorHash.InvalidOriginObjectCategoryId,
      ],
    ]
  }

  // ... isValidX() predicates + create*Inspector helpers (see validator-pattern.md) ...
}
```

## Directory & naming

- **Validators:** `app/validator/forResolver/<endpoint>/<operation-kind>/<Operation>InputValidator.js`
  - `<endpoint>` tracks the GraphQL endpoint the resolver belongs to (`user`, `customer`, `admin`,
    …) — it changes per endpoint.
  - `<operation-kind>` is **`queries`** or **`mutations`**.
  - e.g. `app/validator/forResolver/user/queries/EmailInsertableVariablesInputValidator.js`,
    `app/validator/forResolver/user/mutations/CreateFooInputValidator.js`.
- **Shared under `app/validator/forResolver/`:** `BaseInputValidator.js` and reusable validators such
  as `NormalPaginationInputValidator.js` (default-exported, commonly imported as
  `PaginationInputValidator`).
- **Inspectors:** imported directly from `@openreachtech/mentsu-value-inspector` (`ValueInspector` /
  `NumberValueInspector` / `IntegerValueInspector`)
  ([inspector-api.md](./references/inspector-api.md)).
- Class name = `<Operation>InputValidator` (PascalCase, matching the resolver's `schema`).

## Predicates & the inspector

Each rule is an `isValidX()` method. For value-shape checks, build an inspector via a small
`create*ValueInspector({ value })` helper and call its methods:

```js
isValidOriginObjectCategoryId () {
  const inspector = this.createIntegerValueInspector({
    value: this.input.originObjectCategoryId,
  })

  // the module has no isPositiveInteger — compose it (string-tolerant *Like)
  return inspector.isIntegerLike()
    && inspector.isPositiveNumberLike()
}

createIntegerValueInspector ({
  value,
}) {
  return IntegerValueInspector.create({
    value,
  })
}
```

- **Optional field idiom:** return `true` early when the field is absent, then check the shape —
  e.g. `if (!keyword) { return true }` before `return typeof keyword === 'string'`.
- The `*Like` methods accept numeric **strings**, which is what you want at the GraphQL boundary;
  there is no `isPositiveInteger`, so compose it ([inspector-api.md](./references/inspector-api.md)).

## Error hash & resolver wiring

The resolver declares the codes and passes its `errorHash` into the validator:

```js
/** @override */
static get errorCodeHash () {
  return {
    ...super.errorCodeHash,

    InvalidKeyword: '400.C001.001',
    InvalidOriginObjectCategoryId: '400.C001.002',
    InvalidPaginationLimit: '400.C001.003',
    InvalidPaginationOffset: '400.C001.004',
    InvalidPaginationSort: '400.C001.005',
  }
}

/** @override */
async resolve ({
  variables: {
    input,
  },
  context,
}) {
  EmailInsertableVariablesInputValidator
    .create({
      input,
      errorHash: this.errorHash,
    })
    .validate()

  // ... input is now trusted ...
}
```

`create({ input, errorHash })` and the run entrypoint (shown as `validate()`) are provided by
`BaseInputValidator` — match the actual base API in your framework.

## Testing

Predicates are pure booleans, so unit-test them (and `generateValidationEntries`) with the
`hc-jest` skill: feed inputs, assert `isValidX()` results and that invalid input
raises the expected `InvalidXxx`.

## Detail files

- [inspector-api.md](./references/inspector-api.md) — the `@openreachtech/mentsu-value-inspector`
  API (strict vs `*Like`, presence / number / integer, composing positive-integer, cheat sheet)
- [validator-pattern.md](./references/validator-pattern.md) — the full validator template
  (`generateValidationEntries`, predicates, inspector helpers, composed pagination, typedefs), the
  `BaseInputValidator` contract, resolver wiring, and testing
