# Directory structure (release-split master / dev-master / development)

The three kinds of seeder directory, what each is for, the `db:seed:*` scripts, and the re-export
DRY pattern. Referenced from §1 of `SKILL.md`.

## Two axes: environment, and kind of data

Every seeder directory is classified by **environment** (production vs dev / CI) and **kind of
data** (canonical master vs operational fixtures). This is what tells you where a new seeder
belongs.

| Directory | Script (`--seeders-path`) | Environment | Kind of data |
| --- | --- | --- | --- |
| `master-000001/`, `master-000002/`, … | `db:seed:prod` | production | Canonical **master** (reference / config) data. |
| `dev-master/` | `db:seed:dev-master` | dev / CI (local + CI tests) | The **master** data for dev / CI. |
| `development/` | `db:seed:dev` | dev / CI (local + CI tests) | **Operational fixtures** for unit tests. |

- **Deciding where a seeder goes**: is it canonical data the running product depends on (providers,
  models, tools, agents, JSON schemas, wizard templates, day-rates, packages)? → master. Is it data
  a user / operator would create at runtime (customers, admins, payments, orders)? → `development`,
  and only to give tests something to read.

## Production master is split one directory per release

Production master seeders are organized into **release-numbered directories**
`master-<6-digit>/` — `master-000001/`, `master-000002/`, `master-000003/`, … — each holding the
master data introduced or changed in that release.

- `db:seed:prod` applies the `master-*` directories **in ascending order**, so a later release
  builds on the state left by earlier ones. Each release's master additions stay isolated and
  traceable to the release that shipped them.
- **Current state**: the repo still has a single, pre-split `sequelize/seeders/master/`, and
  `db:seed:prod` targets it directly. The release split is the **convention from here on**; the
  `db:seed:prod` script is updated to enumerate `master-*` in order when the split lands.
- Within a release dir, files keep the normal seeder skeleton and the standard seeder filename
  ([naming.md](./naming.md)).

## dev-master vs development — the key distinction

Both run **only in dev / CI** (local machines and CI test runs), never in production. What differs
is the *kind* of data:

- **`dev-master/`** — the **same kind of canonical / config data as production master**, just loaded
  into the dev / CI database. It mostly **re-exports** the production master files (so dev / CI sees
  exactly production's master state), plus a few dev-only master samples for data that production
  creates through the admin CRUD rather than through a seeder (e.g. `content-plan-rates`,
  `software-packages`).
- **`development/`** — **operationally-created data**: rows that in production come into existence at
  runtime through normal operation (customer lists, admin lists, payment lists, orders, …).
  Production never seeds these. They exist purely to give **unit tests** (local + CI) realistic rows
  to read. They are organized as `*-suite` bundles ([naming.md](./naming.md)) and use the large
  10,000-wide id blocks ([id-numbering.md](./id-numbering.md)).

- **Why keep them separate**: master data is part of the product and ships to production; fixture
  data is test scaffolding and must never reach production. Splitting the directories keeps that
  boundary unambiguous, and lets `db:seed:prod` load master alone while `db:refresh` loads master +
  fixtures for local work.

## The `.directorykeeper.cjs` no-op

Each directory contains a `.directorykeeper.cjs` whose `up` / `down` do nothing.

```js
'use strict'

module.exports = {
  async up () {
    // noop
  },
  async down () {
    // noop
  },
}
```

- **Why**: it keeps an otherwise-empty directory tracked in git and gives the seeder runner a valid
  file to load even before any real seeder exists in that directory. Do not delete it.

## Scripts and the refresh flow

| Script | What it does |
| --- | --- |
| `db:seed:prod` | seed the production `master-*` set (`--seeders-path` at the master dirs) |
| `db:seed:dev-master` | seed `sequelize/seeders/dev-master` |
| `db:seed:dev` | seed `sequelize/seeders/development` |
| `db:refresh` (alias `npm run r`) | `NODE_ENV=development` → teardown → migrate → **seed:dev-master** → **seed:dev** |

- `db:refresh` deliberately runs **dev-master + development** and **not** `seed:prod` — dev / CI
  wants the master config plus the test fixtures, and the release-split `master-*` set is for
  production.
- After changing any seeder, run `npm run r` to rebuild the local DB (or run the single matching
  `db:seed:*` script to load just that set without a full teardown).

## Re-export a production master file (DRY)

When a `dev-master/` file must be byte-for-byte the same as a production master file, do not
copy-paste — **re-export** it. Keep the same filename ([naming.md](./naming.md)).

```js
// dev-master/20260717135803-000001-ai_models.cjs
'use strict'

/*
 * dev-master duplicate: apply the same AI config as the production master in dev / CI (db:refresh).
 * The real data/logic lives in the production master release dir (DRY).
 */
module.exports = require('../master-000001/20260717135803-000001-ai_models.cjs')
```

- **Why**: dev / CI must exercise the *exact* master rows production ships. Re-exporting keeps a
  single source of truth (the `master-*` file); copy-pasting would let the two drift silently.
- A `dev-master/` file that is **not** in production master (a dev-only sample) is a normal seeder,
  not a re-export.
