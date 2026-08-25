---
name: hb-constant-definition
description: >
  Define application constants the Renchan way: one constant (one category) per file, ALWAYS as
  two files — a CommonJS master constants/<name>.cjs (the single source of truth) plus an ESM
  bridge app/constants/<name>.js that re-exports it. Use this skill whenever the user asks to add
  or change a constant — an enum-like value set, a status/category hash, or a master-data id/name
  table.
---

# Constant Definition

A skill for defining **application constants**. There is **one rule and no case-by-case judgment**:
every constant is defined as **two files** — a CommonJS **master** and an ESM **bridge**. Deciding
per-constant whether a seeder will ever need it is error-prone, so you skip that decision and always
provide both.

> This skill states a **general, project-independent rule** — a refined best practice, not a
> description of any one project's current code, so it need not match a given repo's existing
> notation. The directory and value names in it (`constants/`, `app/constants/`, `memberRankConstants`,
> …) are **illustrative fakes**; use your project's own names. The two-file rule exists because
> application code is **ESM** (`import` / `export`) while seeders are **CommonJS** (`.cjs`, loaded with
> `require`), so a shared constant must be readable from both.

## Grand principle: one category per file, always defined as a `.cjs` master + a `.js` bridge

A constant file holds **exactly one category** of values (one hash / one set). For every constant you
create **both** of these, with the **same base name**:

| File | Module system | Role |
| --- | --- | --- |
| `constants/<name>.cjs` (repo root) | CommonJS | **Master — the single source of truth.** The actual values. |
| `app/constants/<name>.js` | ESM | **Bridge — a pure re-export** of the `.cjs` via the custom `require`. |

- **Why always both (no per-constant decision).** Master data — ids + names that both **seed rows**
  and **app logic** must agree on — is one source of truth read from two module systems: seeders
  `require` the `.cjs` directly; ESM app code reaches it through the bridge. Predicting up front which
  constants a seeder will *eventually* need is tricky and gets it wrong, so define the pair every
  time. The cost is one trivial six-line bridge; the payoff is any consumer can read any constant.
- **The `.cjs` is the only copy of the values.** The `.js` bridge never restates them — it just
  crosses the module boundary. Two hand-maintained copies drift; keep exactly one.
- **Why one category per file.** A category maps to a predictable file name. This mirrors the
  "one file, one class" and "vertical over horizontal" principles — a grab-bag `constants.js` forces
  every reader to scan an unrelated pile.

**Comment language**: the `js` examples here use English comments. In the constant files you
generate, keep structural comments in English and write any domain notes in whatever language the
project uses for domain prose — match the surrounding files.

## 1. Where the two files live

| Directory | Module system | Holds |
| --- | --- | --- |
| `constants/` (repo root) | CommonJS (`.cjs`) | The **master** — the file seeders `require` directly. |
| `app/constants/` | ESM (`.js`) | The **bridge** — the file app code imports. |

- **App code always imports the bridge**: `import MEMBER_RANK_CONSTANT_HASH from '../constants/memberRankConstants.js'`. App code never reaches into the root `constants/*.cjs` itself.
- **Seeders always `require` the master**: `require('../../../constants/memberRankConstants.cjs')` — because seeders are written in CommonJS.

## 2. The `.cjs` master (source of truth)

`'use strict'` + `module.exports = { ... }`, a single SCREAMING_SNAKE category. This is the file the
values actually live in.

```js
// Good: constants/memberRankConstants.cjs — the single source of truth (CommonJS)
'use strict'

module.exports = {
  MEMBER_RANK: {
    BRONZE: {
      ID: 1,
      NAME: 'Bronze',
      IS_ACTIVE: true,
      DISPLAY_ORDER: 10,
    },
    SILVER: {
      ID: 2,
      NAME: 'Silver',
      IS_ACTIVE: true,
      DISPLAY_ORDER: 20,
    },
    // ...
  },
}
```

## 3. The `.js` bridge

Import the custom `require` from the project's globals module, `require` the sibling `.cjs`, and
`export default` it. **Same base name** as the `.cjs`. This is the whole file — never more:

```js
// Good: app/constants/memberRankConstants.js — thin ESM bridge over the .cjs master
import {
  require,
} from '../globals/_.js'

const MEMBER_RANK_CONSTANT_HASH = require('../../constants/memberRankConstants.cjs')

export default MEMBER_RANK_CONSTANT_HASH
```

- **`require` here is the custom one** — `createRequire(import.meta.url)`, re-exported from the
  project's globals module (here `../globals/_.js`). It lets an ESM file load a `.cjs`; there is no
  native `require` in ESM.
- The bridge is a **pure re-export** — no reshaping, no merging, no extra keys. If you find yourself
  transforming the value in the bridge, that logic belongs elsewhere.
- The two consumers then read the **one** source:

```js
// seeder (.cjs) — requires the master directly
const { MEMBER_RANK } = require('../../../constants/memberRankConstants.cjs')

// app (ESM) — imports the bridge
import MEMBER_RANK_CONSTANT_HASH from '../constants/memberRankConstants.js'
```

```js
// Avoid: stopping at an ESM-only definition (no .cjs master)
export default { MEMBER_RANK: { /* ... */ } } // a seeder (.cjs) cannot import this; always add the .cjs master
```

## 4. Naming

- **File**: camelCase, named after the category (`memberRankConstants`, `userPermission`). The `.cjs`
  master and its `.js` bridge share the **same base name**.
- **Exported constant**: `SCREAMING_SNAKE_CASE` (`MEMBER_RANK_CONSTANT_HASH`, `USER_PERMISSION`). A
  `_HASH` / `_CONSTANTS` suffix is common for a lookup hash but not mandatory — name it for the
  category, not the type, and follow the Renchan naming rules (no forbidden suffixes such as
  `info` / `data` / `list`).
- **One category per file** — if tempted to add a second, unrelated set, make another pair of files.

## Finishing checklist

- [ ] **Both files exist** with the same base name: `constants/<name>.cjs` (master) **and** `app/constants/<name>.js` (bridge).
- [ ] The values live **only** in the `.cjs`; the `.js` is a pure re-export via the custom `require` (no reshaping, no duplication) ([§3](#3-the-js-bridge)).
- [ ] The file holds **one category**, exported SCREAMING_SNAKE (default export).
- [ ] App code imports the `.js`; seeders `require` the `.cjs` ([§1](#1-where-the-two-files-live)).
