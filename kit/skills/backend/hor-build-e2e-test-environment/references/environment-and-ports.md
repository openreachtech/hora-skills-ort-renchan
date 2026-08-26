# Environment values and ports

The E2E stack's dedicated environment name and standalone env file, which values must differ from
the other environments and why, and how host addresses differ from in-network ones. Referenced from
§3 and §4 of [SKILL.md](../SKILL.md). `<stack-env>` stands for the environment name that belongs to
the E2E stack alone — `live-local` is the recommended name.

> **One example stack's keys.** `KAFKA_BROKERS`, `ELASTICSEARCH_BASE_URL`, `CDC_DATABASE_NAME` and
> the rest are **illustrations**: each *role* ([SKILL.md §1](../SKILL.md)) needs its own address,
> name and scratch space for the run. Map each row onto the keys the project actually reads.

## A dedicated environment, and a standalone env file

The stack runs under an environment name of its own (`NODE_ENV=<stack-env>`, recommended
`live-local`) and reads its own committed `.env.<stack-env>` at the repository root. The name is
derived from the real-dialect test environment (`live` in the backend testing convention): both
select the same database engine, but `live` exists for running the unit suite against the real
dialect, while `<stack-env>` describes a **running full stack**. A dedicated name means every
command that carries `NODE_ENV=<stack-env>` — the application, the schema tooling, a seeder run by
hand — resolves to the E2E stack's own values automatically, instead of relying on someone
remembering to set overrides.

Two rules govern the file:

- **It is complete and standalone.** Every key the application, the tooling and the background
  processes read must be present — the facade returns `null` for a missing key instead of throwing
  (see the last section), so a gap surfaces as a confusing failure deep inside a service call.
  When authoring the file, start from the key set of the fullest existing env file and set every
  value deliberately.
- **Shared values are independent copies, deliberately.** The database connection shape in
  `.env.live` and in `.env.<stack-env>` may coincide today; they are still two environments' own
  values, and each file is the source of truth for its own environment. Do not build one env file
  out of another by reference, import or generation. When the stack gains a component or a key,
  updating every environment's file is part of that change — a key added to only one of them shows
  up as the `null` the other reads for it.

The **groups of comments** below are what to reproduce in `.env.<stack-env>`; the key names inside
them belong to the example stack:

```bash
# .env.<stack-env> — the E2E stack's own environment, committed at the repository root.

# the E2E port block — only if this stack must run beside the developer's own (§ ports below)
DATABASE_PORT=13306
REDIS_PORT=16379
KAFKA_BROKERS=127.0.0.1:19092
ELASTICSEARCH_BASE_URL=http://127.0.0.1:19200
KAFKA_CONNECT_URL=http://127.0.0.1:18083

# a schema, an index and a topic namespace that belong to the E2E stack alone
DATABASE_NAME=<project>_e2e_db
# MUST equal DATABASE_NAME — see below. (No inline comments: some dotenv parsers keep them in the value)
CDC_DATABASE_NAME=<project>_e2e_db
SEARCH_INDEX_NAME=<index>_e2e
KAFKA_CONSUMER_GROUP_ID=<consumer-group>-e2e

# per-run scratch space, so uploads never land in the working tree
FILE_STORAGE_PATH=e2e/.storage

# a feature that needs a host-installed tool: decided explicitly, not by accident
<FEATURE>_ENABLED=false

# values the compose file substitutes into ${...} — reach compose via --env-file, see below
DATABASE_PASSWORD=<development-grade>
ELASTICSEARCH_PASSWORD=<development-grade>
```

Three things about this file that are not obvious:

- **`docker compose` does not read `.env.<stack-env>` on its own.** For variable substitution it
  reads the process environment and a `.env` sitting **next to the compose file** — so any `${...}`
  the compose file interpolates has to reach it another way: point compose at the stack's file with
  `--env-file .env.<stack-env>` in the runner, or export those values before invoking compose. A
  password compose cannot see substitutes as an **empty string**, with only one warning line shown,
  and the service starts with no password set: exactly the quiet half-built stack this skill is
  about.
- **Anything run by hand against the environment has to carry `NODE_ENV=<stack-env>`.** A seeder or
  migration invoked under the wrong environment name talks to that environment's stack — the
  disaster the dedicated name exists to prevent. Bake the name into the npm scripts (as the seed
  scripts in [seed-data.md](./seed-data.md) do) so it cannot be forgotten.
- **The file is committed, and a name beginning with `.env` may quietly prevent that.** Projects
  routinely ignore `.env*`; check the repository's `.gitignore` before relying on the file being
  tracked, because a silently untracked env file means the next developer's build reads `null` for
  every key and fails somewhere deep. The file holds development-grade fixture values only, so
  committing it is correct.

## Exports still override the file

The environment resolver merges the dotenv file first and the process environment last:

```js
// the resolver's merge — the exported variable wins
const assignedEnv = {
  ...this.loadedDotenv,
  ...this.processEnv,
}
```

- An exported variable **wins** over the same key in the file, for **everything that reads through
  the facade** — the application, the schema tooling, the seeders. Useful for a one-off tweak
  (a different port for a single run) without editing the committed file.
- The same precedence is a **trap**: a stray variable left exported in the shell silently overrides
  the committed value, with no warning. When the stack behaves as if the file said something else,
  check the shell's environment first.
- Ordinary dotenv loaders do the opposite (the file leaves an existing variable alone, and the
  variable likewise leaves alone any value the file *did* set into the same object). Verify the
  direction in the resolver you actually have before relying on it; here it is the merge above.

## The values that must differ, and which of them your project actually needs

Two questions decide the list (§3 of [SKILL.md](../SKILL.md)): **does this stack run beside the
developer's own**, and **may a build destroy or pollute what the developer already has**. The first
question owns the port block; the second owns every name. Even when both are answered no — the E2E
stack *replaces* the developer's stack rather than coexisting with it, and that stack is itself
disposable — the dedicated `.env.<stack-env>` still exists; the answers only decide whether its
values may coincide with the development environment's.

The left column names **what kind of value** it is; the key in parentheses is what the example stack
calls it.

| Value | What goes wrong when it is left equal to the development environment's |
| --- | --- |
| **the port block** (every `*_PORT` / `*_URL` / `*_BROKERS`) | the environment silently talks to the developer's own stack, and every screen shows that data instead of the seeded one |
| **the system of record's name** (`DATABASE_NAME` — a schema, database or namespace) | the schema step **drops and recreates** — pointed at the development database, a build destroys a day of work |
| **every identity a derived name is built from** (`CDC_DATABASE_NAME`) | the example's change topic is named `<prefix>.<database>.<table>`, so a stale value makes the consumer subscribe to topics nothing ever writes to. Nothing errors; nothing ever propagates, and the screen simply never updates. This is the single most confusing failure in this environment — and it recurs in any stack where a channel, slot, subscription or stream name is **composed** out of another value |
| **the read model's name** (`SEARCH_INDEX_NAME` — an index, view, table or key prefix) | the run **writes into** whatever it names, and the backfill step writes *every* row — so a stale name pollutes the developer's read model, and a screen can show a document this environment never created. (Setup itself only creates: a read model that already exists is left as it is, which is exactly why a stale name is not caught) |
| **the object storage location** (`FILE_STORAGE_PATH` — a directory, bucket or key prefix) | uploaded and derived files land in the working tree, so the run pollutes the repository and two runs see each other's files |

**A subscriber identity of its own** is worth adding too (`KAFKA_CONSUMER_GROUP_ID` here, a
replication slot name, a subscription name, a durable-consumer name elsewhere): if a run is ever
pointed at a shared transport, a shared identity means two subscribers split the stream and each sees
half its events.

## Host addresses vs in-network addresses

The same service has **two addresses**, and which one a value needs depends on **who reads it**. The
rows are the example stack's values; the rule — *host process → `127.0.0.1` + published port,
container process → service name + container port* — holds for every component:

| Value | Read by | Address |
| --- | --- | --- |
| `DATABASE_HOST` / `DATABASE_PORT` | the application and tooling, on the **host** | `127.0.0.1` + the published port (`13306`) |
| `KAFKA_BROKERS` | the consumer, on the **host** | `127.0.0.1:19092` |
| `ELASTICSEARCH_BASE_URL`, `KAFKA_CONNECT_URL` | the runner and application, on the **host** | `127.0.0.1` + published port |
| `CDC_DATABASE_HOST` / `CDC_DATABASE_PORT` | the **connector, inside a container** | the service name (`mariadb`) and the **container's** port (`3306`) |
| Connect's own `BOOTSTRAP_SERVERS` | the **connector, inside a container** | `kafka:9092` |

- **The capture connector's database port stays `3306` even when the host publishes `13306`.** Inside
  the compose network there is no port remapping — `127.0.0.1` there means the connector's own
  container, and the published port does not exist.
- **Only the in-network values live in the compose file**; the host-facing ones live in
  `.env.<stack-env>`. Mixing the two is the second most common wiring mistake after the broker's
  advertised port.

## The port block

One offset applied to every role the project has — the components named here are the example's:

| Role (example component) | Development | Test stack |
| --- | --- | --- |
| system of record (relational database) | `127.0.0.1:3306` | `127.0.0.1:13306` |
| cache and job queue (Redis) | `127.0.0.1:6379` | `127.0.0.1:16379` |
| event transport (Kafka) | `127.0.0.1:29092` | `127.0.0.1:19092` |
| read model (search cluster) | `127.0.0.1:9200` | `127.0.0.1:19200` |
| change propagation (Connect / capture API) | `127.0.0.1:8083` | `127.0.0.1:18083` |

- **`127.0.0.1` is part of the mapping, not a comment.** `ports: ['13306:3306']` binds every
  interface on the machine, which puts an unauthenticated database, an unauthenticated queue and an
  unauthenticated connector-registration API on whatever network the machine is attached to. With the
  prefix they are reachable from this machine only.
- **No `ports:` at all for a service the host does not reach.** Container-to-container traffic uses
  the compose network. Add a published port only when a host process — the build script, the
  application, a developer's browser or inspection command — connects to it, and note in a comment
  which one does.
- **A service that advertises its own address is the exception to free remapping**: its published port
  must equal the port it binds and advertises, because the client is redirected to that advertised
  address after connecting. The broker is the example; a clustered queue or a replica set that names
  its own members behaves the same way ([compose-definition.md](./compose-definition.md)).
- **Passwords stay development-grade and never go into the repository in any other form.** A fixture
  password committed beside a loopback-only stack is acceptable; the same value reused for anything
  reachable is not.

## A missing key reads as `null`

The environment facade wraps its hash in a proxy that returns `null` for a key it does not have,
rather than `undefined` or an error:

```js
get (target, key) {
  if (!Reflect.has(target, key)) {
    return null
  }

  return Reflect.get(target, key)
}
```

So a variable the env file never defined does not fail at startup — it becomes `null` and surfaces
much later, as a request to `null/_search`, a connection to port `null`, or a file written to a path
built from `null`. When the environment behaves strangely, **check that every key the code path
reads is actually present** before looking at the wiring.
