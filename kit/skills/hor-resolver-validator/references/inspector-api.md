# mentsu-value-inspector API

The value-inspection module validators use for per-value checks. Referenced from
[SKILL.md](../SKILL.md). Full docs: the package README on npm.

Validators **import directly from the module** — it is published, so use it from the package (do not
hand-roll a local wrapper):

```bash
npm install @openreachtech/mentsu-value-inspector@1.1.0
```

```js
import {
  IntegerValueInspector,
} from '@openreachtech/mentsu-value-inspector'

const inspector = IntegerValueInspector.create({
  value: this.input.originObjectCategoryId,
})
```

## Classes & hierarchy

Three classes, each a named export of the package root; each subclass inherits all its parents'
methods, so instantiate the most specific one you need:

```
ValueInspector            // presence checks
└── NumberValueInspector  // + number checks + normalizeValue()
    └── IntegerValueInspector  // + integer / safe-integer checks
```

## strict vs `*Like`

Every number/integer check comes in two flavors:

| Flavor | Reads | Accepts numeric strings | Example |
| :-- | :-- | :-- | :-- |
| **strict** | the raw value | No | `isNumber('3.14')` → `false` |
| **`*Like`** | the normalized value | Yes | `isNumberLike('3.14')` → `true` |

`*Like` normalizes first (number/string accepted): `'100'` → `100`, while `true` / `1000n` / `{}` /
`'abc'` / `null` / `undefined` → `null` and every `*Like` returns `false`. **`''` normalizes to
`0`** (so `isIntegerLike('')` → `true`). At the GraphQL/REST boundary prefer the string-tolerant
(`*Like`) checks, since inputs often arrive as strings.

## Presence (`ValueInspector`)

| Method | Returns |
| :-- | :-- |
| `isNull()` | `value === null` |
| `isUndefined()` | `value === undefined` |
| `isNullish()` | `null` or `undefined` |
| `isDefined()` | not `undefined` |
| `isPresent()` | neither `null` nor `undefined` |

## Numbers (`NumberValueInspector`)

| Method | Reads | Meaning |
| :-- | :-- | :-- |
| `isNumber()` / `isNumberLike()` | raw / norm | finite number |
| `isPositiveNumber()` / `isPositiveNumberLike()` | raw / norm | finite `> 0` |
| `isNegativeNumber()` / `isNegativeNumberLike()` | raw / norm | finite `< 0` |
| `isZero()` | raw | `value === 0` (incl. `-0`) |
| `isNaN()` / `isFinite()` / `isInfinite()` | raw | NaN / finite / ±Infinity |
| `normalizeValue()` | — | normalized `number`, or `null` (lazy + memoized) |

## Integers (`IntegerValueInspector`)

| Method | Reads | Meaning |
| :-- | :-- | :-- |
| `isInteger()` / `isIntegerLike()` | raw / norm | integer |
| `isSafeInteger()` / `isSafeIntegerLike()` | raw / norm | safe integer (`±(2^53 − 1)`) |

## There is no `isPositiveInteger` — compose it

The module has no positive-integer method; combine an integer check with a positive check on the same
inspector (string-tolerant `*Like` at the boundary):

```js
const inspector = IntegerValueInspector.create({
  value: this.input.originObjectCategoryId,
})

// "positive integer" (accepts '42')
inspector.isIntegerLike()
  && inspector.isPositiveNumberLike()

// for an id, also require it to be safe:
inspector.isSafeIntegerLike()
  && inspector.isPositiveNumberLike()
```

## Behavior cheat sheet

| Input | `isNumber` | `isNumberLike` | `isInteger` | `isIntegerLike` | `isSafeIntegerLike` |
| :-- | :-: | :-: | :-: | :-: | :-: |
| `42` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `'42'` | ❌ | ✅ | ❌ | ✅ | ✅ |
| `3.14` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `'3.14'` | ❌ | ✅ | ❌ | ❌ | ❌ |
| `Infinity` / `NaN` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `9007199254740993` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `1000n` / `true` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `null` / `undefined` | ❌ | ❌ | ❌ | ❌ | ❌ |

## Recipes for predicates

- **Positive integer (id):** `inspector.isIntegerLike() && inspector.isPositiveNumberLike()`
  (or `isSafeIntegerLike()` for ids).
- **Optional field:** return `true` early when absent (`if (!value) { return true }`), then check.
- **Required present:** `inspector.isPresent()`.
- **Read the coerced number after validating:** `inspector.normalizeValue()` — don't re-parse.
- **Guard empty string** for required numeric fields, since `''` normalizes to `0`.
