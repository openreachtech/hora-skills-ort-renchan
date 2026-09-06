# Validator pattern (template, base contract, integration, testing)

The full `*InputValidator` template, the `BaseInputValidator` contract, resolver wiring, and testing.
Referenced from [SKILL.md](../SKILL.md).

## Full template

A validator extends `BaseInputValidator`, overrides `generateValidationEntries()`, and adds one
`isValidX()` predicate per rule plus small `create*` helpers for the sub-validators / inspectors it
uses. This is the standard shape (a query validator that reuses pagination):

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

  /**
   * Create a PaginationInputValidator instance
   *
   * @param {{
   *   input?: EmailInsertableVariablesInput
   * }} [params]
   * @returns {PaginationInputValidator}
   */
  createPaginationInputValidator ({
    input = this.input,
  } = {}) {
    return PaginationInputValidator.create({
      input,
      validColumns: VALID_SORT_COLUMNS,
    })
  }

  /**
   * Validate keyword
   *
   * @returns {boolean}
   */
  isValidKeyword () {
    const {
      keyword = null,
    } = this.input

    if (!keyword) {
      return true
    }

    return typeof keyword === 'string'
  }

  /**
   * Validate originObjectCategoryId
   *
   * @returns {boolean}
   */
  isValidOriginObjectCategoryId () {
    const inspector = this.createIntegerValueInspector({
      value: this.input.originObjectCategoryId,
    })

    // the module has no isPositiveInteger — compose it (string-tolerant *Like)
    return inspector.isIntegerLike()
      && inspector.isPositiveNumberLike()
  }

  /**
   * Create an IntegerValueInspector instance
   *
   * @param {{
   *   value: number | string
   * }} params
   * @returns {IntegerValueInspector}
   */
  createIntegerValueInspector ({
    value,
  }) {
    return IntegerValueInspector.create({
      value,
    })
  }
}

/**
 * @typedef {{
 *   InvalidKeyword: RenchanGraphqlErrorCtor
 *   InvalidOriginObjectCategoryId: RenchanGraphqlErrorCtor
 *   InvalidPaginationLimit: RenchanGraphqlErrorCtor
 *   InvalidPaginationOffset: RenchanGraphqlErrorCtor
 *   InvalidPaginationSort: RenchanGraphqlErrorCtor
 * }} ErrorHash
 */

/**
 * @typedef {import('../../BaseInputValidator.js').RenchanGraphqlErrorCtor} RenchanGraphqlErrorCtor
 */

/**
 * @typedef {graphql.EmailInsertableVariablesInput} EmailInsertableVariablesInput
 */
```

## `BaseInputValidator` contract

The base (`app/validator/forResolver/BaseInputValidator.js`) provides the logic so subclasses
only declare rules:

- **Instance state:** `this.input` (the resolver input) and `this.errorHash` (the resolver's error
  constructors), supplied through the factory.
- **`generateValidationEntries()`** — abstract; the subclass returns
  `Array<[() => boolean, RenchanGraphqlErrorCtor]>`.
- **Run entrypoint** — iterates the entries and, for the first entry whose predicate returns
  `false`, raises that `ErrorCtor`. (Shown as `validate()` in the wiring below; use whatever the
  actual base names it.)
- Generic JSDoc `@extends {BaseInputValidator<ErrorHash, InputType>}` documents the error hash and
  input shapes for that validator.

## Predicate conventions

- **One `isValidX()` per rule**, returning a boolean, reading `this.input`. Never throw inside a
  predicate — returning `false` is how a rule fails; the base turns that into the error.
- **Optional fields pass when absent:** destructure with a default and short-circuit, e.g.
  `const { keyword = null } = this.input; if (!keyword) { return true }`.
- **Value-shape checks go through an inspector** via a `create*ValueInspector({ value })` helper —
  e.g. `this.createIntegerValueInspector({ value })` then compose
  `isIntegerLike() && isPositiveNumberLike()` (there is no `isPositiveInteger` in the module). See
  [inspector-api.md](./inspector-api.md).

## Compose shared validators (don't re-implement pagination)

Pagination (limit / offset / sort) is validated by the shared `PaginationInputValidator`
(`NormalPaginationInputValidator.js`). Create it with the input and the allowed sort columns, then
reference its `isValidLimit()` / `isValidOffset()` / `isValidSort()` from your entries — as the
template does. Do the same for any other cross-cutting validator rather than duplicating its rules.

## Resolver wiring

The resolver declares the error codes (so each `InvalidXxx` has a code) and runs the validator with
its own `input` and `errorHash`:

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

- The error names in the validator's `ErrorHash` typedef must match keys in the resolver's
  `errorCodeHash`.
- `create({ input, errorHash })` and the run entrypoint come from `BaseInputValidator`; align with
  the actual base API.

## Testing

Predicates are pure, so unit-test them directly with the `hoc-jest` skill — no
resolver, no DB. Instantiate the validator with a stub `errorHash` and assert each `isValidX()`, and
assert that invalid input raises the matching `InvalidXxx` through the run entrypoint.

```js
describe('EmailInsertableVariablesInputValidator', () => {
  describe('isValidOriginObjectCategoryId', () => {
    /* eslint-disable */
 },
      {
        input: {
          originObjectCategory    const cases = [
      {
        input: {
          originObjectCategoryId: 1,
        },
        expected: true,
     Id: '1',
        },
        expected: true,
      },
      {
        input: {
          originObjectCategoryId: 0,
        },
        expected: false,
      },
      {
        input: {
          originObjectCategoryId: -1,
        },
        expected: false,
      },
      {
        input: {
          originObjectCategoryId: 'abc',
        },
        expected: false,
      },
    ]
    /* eslint-enable */

    test.each(cases)('input $input', ({
      input,
      expected,
    }) => {
      const validator = EmailInsertableVariablesInputValidator.create({
        input,
        errorHash: {},
      })

      expect(validator.isValidOriginObjectCategoryId()).toBe(expected)
    })
  })
})
```
