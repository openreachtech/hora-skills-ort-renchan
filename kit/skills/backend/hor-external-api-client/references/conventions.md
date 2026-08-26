# Conventions (the naming and coding checklist)

The naming and coding conventions for writing an external API client: the repository-wide coding
conventions plus the items specific to this module. Referenced from [SKILL.md](../SKILL.md). The
cross-cutting rules that matter most — `fetch` only, decide failure with `hasError()`, return `null`,
comments in English — are in [SKILL.md](../SKILL.md).

## Class layout and naming

- **One class per file**, with a single `export default`.
- Class names are Upper CamelCase. Name a derived launcher `<Operation>Launcher`, and the payload and
  capsule `<Operation>Payload` / `<Operation>Capsule`, so **the operation is readable from the name**.
  The base launcher is `Base<Service>Launcher`.
- **Why include the operation**: one service carries several operations, and without names like
  `CreateDocumentLauncher` / `FindDocumentsLauncher` there is no telling which file is which API.

## Method names are "verb + object", and retrieval verbs differ by source

A retrieval method's prefix distinguishes where the value comes from.

| Prefix | Source |
| :-- | :-- |
| `fetch~` | Retrieved from the external API |
| `find~` | Retrieved from the database |
| `extract~` | Pulled out of a capsule ([capsule.md](./capsule.md)) |

- **Why distinguish them**: retrieval is not one thing — failure means something different, and is
  handled differently, depending on whether the source is the external API, the database or a capsule.
  A consistent prefix makes the kind of I/O readable from the method name alone, and makes it plain at a
  glance that `extract~` performs no external communication.

## A constructor only assigns; defaults belong in the factory

- A `constructor` **only assigns** the values it was given. No default-value construction, no logic.
- Defaults belong in `create()` (the factory method), and a getter only returns the field.
- **Why**: collecting defaults in the factory is what lets a test swap a dependency in, as in
  `create({ sdkClient })` ([sdk-wrapper.md](./sdk-wrapper.md) /
  [usage.md](./usage.md#di-inject-a-stub-launcher)). Logic in the `constructor` removes that seam.

## Control flow and data conversion

- **No single-character variables** — use a meaningful name (`document`, `functionCall`).
- Avoid `for` / `forEach` / `switch` / `else if`; write **`map` / `filter` / `reduce` and early
  returns**. Reshape an array in `extractXxx()` with `map`
  ([capsule.md](./capsule.md#extractxxx-always-guards-against-null-and-returns-null--an-empty-array-when-the-value-is-missing)).
- **Why**: a declarative conversion (`map`/`filter`) makes the input-to-output correspondence easy to
  read, and holding no intermediate state leaves less room for bugs. Readability is everything in code
  that absorbs differences, so avoid imperative loops.

## Notation

- **One property per line in an object literal** — the sample code in this skill included.
- Return **`null`** for a missing value, never `undefined` — or an empty array, or whatever the intended
  default is
  ([SKILL.md](../SKILL.md#return-null-or-an-empty-array-for-a-missing-value-never-undefined)).
- Members are ordered: constructor → factory → static getter → static method → instance getter →
  instance setter → instance method. Keep methods that call one another near each other.
- **Why fix the order**: when every class is ordered the same way, a reviewer's eye goes straight to
  what is specific to this class. When the order varies per class, a deliberate difference and an
  omission look alike.

## No additional HTTP client (restated)

**HTTP communication goes through Node.js's native `fetch` as a rule.** In the direct-HTTP pattern use
the `fetch` built into `BaseLauncher` and implement no HTTP client of your own. **Do not add another
HTTP client module such as axios.** Wrap an SDK only where the SDK owns the external communication
([sdk-wrapper.md](./sdk-wrapper.md) — an interim implementation). The reasoning is in
[SKILL.md](../SKILL.md#http-goes-through-the-native-fetch-only--no-axios-no-http-client-of-your-own).
