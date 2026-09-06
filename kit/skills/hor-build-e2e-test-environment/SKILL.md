---
name: hor-build-e2e-test-environment
description: >
  Build, run and debug the manual local E2E environment under `e2e/docker/` — a
  container-compose stack of the product's real middleware (system of record, cache and job queue,
  event transport, read model, object storage, the reverse-proxy edge), its own seed set, and the
  `up` / `start` / `seed` / `clean` / `down` scripts that drive it. Stated per component role, so
  any stack maps onto it. Use also when adding E2E seed data. Verifying behavior inside the
  environment is out of scope.
---

# Build E2E Test Environment

A skill for building the local environment in which **the whole stack is real**: the application runs
against the actual components it talks to in production — the real store its writes land in, the real
queue its background work goes through, the real transport its change events travel over, the real
derived store its screens read from — instead of against fakes. It exists so a developer can exercise
the product **by hand, through its UI**, against components that behave like the deployed ones.

**Building that foundation is the entire scope.** What to check once the environment is up — which
screens, which flows, which cases — is the operator's business and is deliberately not covered here.
Nor does this environment hold any automated tests: the unit test tree and how it is run belong to
the project's backend test-placement convention, and the two never touch
([§2](#2-where-the-e2e-environment-lives)).

> **The component set used throughout this skill is an example, not a requirement.** Every rule is
> stated for a **role** in the system; the stack the examples are written in — relational database
> with a binlog, Redis, Kafka, a CDC connector, a search cluster — is one way of filling those roles,
> chosen because it exercises all of them at once. Start by mapping your project's own components
> onto the roles ([§1](#1-roles-first-the-component-set-here-is-one-example)), then read every service
> name, image, environment variable, id, port and command below as an **illustration of the shape**,
> not a value to copy. Directory names (`e2e/`, `sequelize/seeders/<stack-env>*/`) are the recommended
> layout, and `<stack-env>` stands for the environment name that belongs to the E2E stack alone —
> **`live-local`** is the recommended name, the local full-stack counterpart of the real-dialect test
> environment `live` ([§3](#3-environment-a-dedicated-environment-name-with-an-env-file-of-its-own)).
> Sample code follows the project's lint style (no semicolons, 2-space indent, trailing commas).

## Core principle: hand over only a fully built stack

To an operator working through the UI, **a missing piece of infrastructure looks exactly like a
broken feature**. If the transport's channels were never created — the step the example fills with
Kafka topic creation — the screen simply does not update, and that looks exactly like a product bug.
An environment that comes up ninety percent of the way without warning makes every manual session a
false bug report — worse than one that refused to start.

So: **every step either completes or aborts the build, naming the log to read.** Four properties get
you there, and the rest of this skill explains how:

1. **One command per intention, fixed order inside each.** Every step is scripted, the steps within
   a script are ordered by dependency, and which script to run is the operator's call rather than
   something a script infers
   ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).
2. **Private.** Everything the compose file starts is reachable only from this machine, and — where
   the two are meant to run at once — everything it starts stays clear of the developer's own stack
   ([§4](#4-ports-are-published-to-loopback-only-on-a-dedicated-block)).
3. **Disposable, and predictably so.** Each command's effect on the data is fixed and stated in its
   name — rebuild, start, seed, clean — so no step has to detect state and the operator always knows
   what survived ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).
4. **Complete.** The **application and its background processes** are started by the same script, not
   left for the operator to remember. Middleware being up is not the same as data moving
   ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).

## What this skill assumes about the machine

Use **Ubuntu, or WSL2 on Windows**, with Docker Engine or something compatible. Plain Windows —
PowerShell or `cmd` — is out of scope. Go through WSL2.

Five rules keep the stack working on the other machines your team uses:

| Rule | What goes wrong without it |
| --- | --- |
| Write scripts for **bash 3.2**, and use no GNU-only option | macOS still ships bash 3.2, with BSD tools. It has no `declare -A`, `mapfile`, `${x,,}`, `timeout`, `date -d` or `grep -P`. To set a deadline, count elapsed seconds in a loop. |
| Budget memory against **what the container runtime was given**, not against the machine | Docker Desktop and WSL2 run containers inside a VM, and WSL2 gives that VM half the machine by default. Budget against the machine and you overflow the VM. On Linux the two numbers are the same, so the mistake is easy to make. |
| Put `*.sh text eol=lf` in `.gitattributes` | A script with CRLF line endings fails with `bash\r: bad interpreter`. Cloning the repository is then enough to break the environment. |
| Reach the edge by **loopback address and port**, not by `server_name` | Routing by host name means editing `/etc/hosts` on every machine. WSL2 rewrites that file by default. |
| Do not use `host.docker.internal` | Podman calls it `host.containers.internal`. You do not need either one if the edge and the application stay on the same side of the container boundary ([§5](#5-the-edge-what-the-browser-actually-connects-to)). |

Scripts for Windows itself are **opt-in**. Write them only when someone asks. The `.sh` scripts stay
the real ones. See [windows-runner.md](./references/windows-runner.md).

## 1. Roles first: the component set here is one example

Before writing anything, **enumerate what the product actually talks to and classify each component
by the role it fills.** The rules in this skill attach to roles, so that list is what makes the rest
of the skill apply to a stack it was not written in.

| Role in the system | What the examples in this skill use | Other stacks fill the same role with |
| --- | --- | --- |
| **system of record** — where the product's writes land | a relational database configured to write a row-format change log | PostgreSQL with logical replication, SQL Server with CDC enabled, a document store with change streams, a local emulator of a managed database |
| **cache and job queue** — where deferred work is queued | Redis behind the job queue | RabbitMQ, a local queue emulator, a table-backed queue in the system of record, an in-memory cache server |
| **event transport** — what carries change events between processes | Kafka in single-node mode | Redpanda, NATS JetStream, a pub/sub or stream emulator, RabbitMQ, the database's own notification channel |
| **change propagation** — what turns a write in the system of record into an update of the read model | a CDC connector running in Kafka Connect | a CDC runner without Connect, an outbox table plus a poller, a database trigger, an application-level write to both stores |
| **read model / search** — the derived store screens read from | a search cluster with an analyzer plugin baked in | another search engine, a materialized view, a denormalized table, a cache the read path is served from |
| **object storage** — where uploaded and derived files live | a per-run directory on the filesystem | an S3-compatible object server, a cloud-storage emulator, a bucket with a per-run prefix |
| **edge** — what the browser actually connects to | nginx as a reverse proxy in front of the application | Apache httpd, Caddy, Traefik, HAProxy, or a managed load balancer / API gateway whose behaviour the product depends on |
| **the application and its own processes** — the product itself | the API server, a worker daemon, a change-log consumer | whatever process set has to be running for a request to be answered end to end |

- **A role your product does not have simply drops out.** No read model means no index-creation step,
  no backfill and none of the propagation traps — and every other rule still holds. Two roles filled
  by one component (a database that is both system of record and job queue) collapse into one service
  and one set of values.
- **Roles the example does not name join the same list.** A mail catcher, an identity-provider stub, a
  payment sandbox, a headless browser: if the product genuinely talks to it, it belongs in the
  environment, or the environment is not end-to-end. Give it the same treatment — loopback-only port
  on the E2E block, healthcheck, started by the runner.
- **What is universal and what is example.** These hold for any stack: one command in dependency
  order with idempotent steps; loopback-only publishing on a port block and compose project name of
  its own; an environment name and env file of the stack's own; a seed set of its own in a reserved id band;
  waiting on healthchecks to a deadline; the application and background processes started by the
  script; abort on failure and hand over on success. What is example is the *mechanics* of each
  component — and each of those mechanics is an instance of a general shape:

| The example's specific detail | The general shape it is an instance of |
| --- | --- |
| `--binlog-format=ROW --binlog-row-image=FULL` on the database | the system of record has to be configured to emit whatever change propagation needs to read, **before** anything reads it |
| the broker's published port must equal its advertised listener port | any service that answers a client with **its own address** must be published on the port it advertises |
| transport channels created explicitly, auto-creation off | the transport's channels must exist, with their final shape, before anything produces to them — some of their properties cannot be changed afterwards |
| the capture database name is part of the change channel's name | every identity a **derived name** is built from must be overridden together with the thing it names |
| a schema-only capture needs a backfill after seeding | data that existed before propagation was wired up never propagates; load it into the read model explicitly |
| the analyzer plugin and connector plugin baked into images | everything a service needs at start is in its image, so the stack comes up with no network access |

Read the rest of the skill through this table: where a section talks about a binlog, a broker or an
index, it is talking about the role — and the general shape is what you carry across to a different
component.

## 2. Where the E2E environment lives

Everything the environment needs — the stack definition and the scripts that build and dispose of
it — is committed under a **single top-level directory of its own**:

```
e2e/
├── docker/                     the stack definition, and everything the compose file references
│   ├── compose.yaml            the services, loopback-published on the E2E port block (§2, §4)
│   ├── nginx/                  the edge configuration the compose file mounts (§5)
│   ├── images/                 build contexts for images that need a plugin baked in
│   │   ├── search/Dockerfile
│   │   └── connect/Dockerfile
│   └── initdb/                 the SQL the system of record runs when its volume is created
├── up.sh                       rebuild: clean → start → seed (§7)
├── start.sh                    bring the stack and the processes up. no data operation (§7)
├── seed.sh                     load the seed set into a stack that is already up (§7)
├── clean.sh                    delete the data in every store — the only script that destroys (§7)
├── down.sh                     stop the processes and the stack, keep the data (§7)
└── logs/                       the background processes' output, git-ignored (§7)
```

Three kinds of thing live here, and the layout says which is which: **`docker/` is the definition**,
the scripts are the **lifecycle**, and `logs/` is the **output**. The **wiring** is the fourth kind
and deliberately lives outside `e2e/`: the stack's own `.env.<stack-env>`, committed at the
repository root beside the other environments' files, where the environment facade finds it
([§3](#3-environment-a-dedicated-environment-name-with-an-env-file-of-its-own)).

- **This directory is entirely separate from the automated test suite.** This directory holds no
  test files, and `npm run test` does not run or use any part of it. The unit suite's promise is
  that it runs in seconds, on a local file database, with no services running; adding this
  environment to the repository must not change that in any way.
- **The separation is of namespaces, not of the machine.** While the stack is up, its resident
  processes — the application, the worker daemons, and anything that **polls on an interval** —
  keep taking CPU and memory the whole time, with no operator touching a screen. Any memory-hungry
  job run beside them — the unit suite in parallel workers is the classic — competes for the same
  memory, and a job that fit on an idle machine can be killed by the operating system on
  one where the stack resides. Two defences, and they are complementary: the compose file **hard-caps
  every container with `mem_limit` and holds the sum of those caps to a conservative slice of the
  memory the container runtime was given** (~40%, sized so two stacks can be up at once), so the stack's *ceiling* is bounded no matter
  what runs beside it ([compose-definition.md](./references/compose-definition.md)); and even under
  that ceiling, run heavy jobs after `down.sh` — or count the stack's capped footprint against the
  memory the job budgets for itself — because the ceiling protects the machine, it does not make the
  memory free.
- **The compose file for E2E is its own file**, not the development one. The development stack is a
  place to *work*; this one is built to be filled from scratch and thrown away — it binds different
  ports, hard-caps every container's memory and holds a smaller heap, and is expected to be destroyed.
  Sharing one file would force the two to compromise.
- **Everything the compose file references by relative path lives beside it, under `docker/`.**
  `build:` contexts, init SQL, config files a service mounts: compose resolves all of them against
  the compose file's own directory, so a path that worked from the repository root resolves
  somewhere else here. Keeping them in one directory means the definition moves as a unit, and no
  entry has to point outside the directory with `../`.
- **Git-ignore what the run produces** — the process logs and the per-run file storage. The
  definition is committed; the output of a session is not.

Besides the env file, the other thing that does **not** live here is the seed data: the E2E seed
sets stay wherever the project's seeder tooling looks for them (`sequelize/seeders/` in the
examples). What separates them there is the **set**, not the path ([§6](#6-data-a-seed-set-of-its-own)).

## 3. Environment: a dedicated environment name, with an env file of its own

The stack runs under an **environment name that belongs to the E2E environment alone** — written
`<stack-env>` here. **`live-local` is the recommended name**: the project's real-dialect test
environment (`live`, per the backend testing convention) selects the same database engine but exists
for running the unit suite against it, not for a running full stack — so the local full-stack
environment gets a name of its own, derived from it. A dedicated name stops a build — or a seeder or
migration run by hand — from reaching the developer's development stack or the `live` test database
by default: `NODE_ENV=<stack-env>` selects the E2E stack's own values everywhere, instead of relying
on every command remembering to apply overrides.

The stack reads its own committed **`.env.<stack-env>`**, at the repository root beside the other
environments' files. Two rules govern that file:

- **It is a complete, standalone description of the E2E stack.** Every key the application, the
  tooling and the background processes read has to be present, because a missing key reads as `null`
  rather than throwing (see below) and surfaces as a confusing failure deep inside a service call.
  When authoring it, start from the key set of the fullest existing env file and set every value
  deliberately.
- **Values shared with another environment are independent copies, deliberately.** The database
  connection shape in `.env.live` and in `.env.live-local` may be identical today; they are still two
  environments' own values, and each file is the source of truth for its own environment. Do not
  build one env file out of another by reference, import or generation — when the stack gains a
  component or a key, updating every environment's file is part of that change. (Note the deliberate
  contrast with seed data, where master rows are **re-exported, never copied**
  ([§6](#6-data-a-seed-set-of-its-own)): seed rows must be identical across environments *by
  construction*, env values are per-environment *by definition*.)

**Which values must differ from the other environments is a decision, not a fixed list.** Two
questions settle it:

| Question | If yes, what it forces |
| --- | --- |
| Must this stack run **beside** the developer's own, both up at once? | a **port block** of its own — otherwise one of the two cannot bind its ports |
| Must a build be unable to **destroy or pollute** what the developer already has? | **names** of its own: the system of record's name, every identity a derived name is built from, the read model's name, and the object storage location |

**The two questions are not equally weighted, because they fail differently:**

| Left equal to another environment's value | How it fails |
| --- | --- |
| the port block | **loudly** — a port is already bound, and nothing starts |
| the system of record's name | **silently and destructively** — [the build drops and recreates the schema](./references/runner-and-lifecycle.md), so it deletes the developer's data |
| every identity a **derived name** is built from | **silently** — the example's change channels are named after the captured database, so a stale value makes the consumer subscribe to channels nobody writes to: nothing propagates and nothing errors |
| the read model's name | **silently** — the build writes into whatever it names, and the backfill step alone writes every row, so it pollutes the developer's read model |
| the object storage location | **silently** — uploads land in the working tree, and two runs see each other's files |

So the second question matters more than the first: a shared port block announces itself, and a shared
name does not. The full table and rationale are in
[environment-and-ports.md](./references/environment-and-ports.md).

Two mechanics of the wiring to keep in mind (details in the same reference):

- **`docker compose` does not read `.env.<stack-env>`.** Any `${...}` the compose file interpolates
  has to reach compose another way — point compose at the file with `--env-file`, or have the runner
  export those values — or it substitutes as an empty string behind a single warning line.
- **An exported shell variable outranks the file**, because the environment facade merges the dotenv
  file first and `process.env` last. Useful for a one-off tweak; also a trap, since a stray variable
  in the shell silently overrides the committed value.

**A value the env file omits reads as `null`, it does not throw.** The facade returns `null` for any
key it does not have, so a forgotten key surfaces later as a confusing failure deep inside a
service call rather than at startup. Check that every key the code reads is present before blaming
the wiring.

## 4. Ports are published to loopback only, on a dedicated block

Two firm rules:

- **Every published port is prefixed with `127.0.0.1`.** `ports: ['13306:3306']` binds every
  interface — on a developer machine that puts an unauthenticated database on the network. Written
  as `ports: ['127.0.0.1:13306:3306']` it is reachable from this machine and nowhere else.
- **A service the host does not need gets no `ports:` entry at all.** Container-to-container traffic
  needs none; the compose network already carries it. Publish a port only because a process on the
  host — the build script, the application, the operator's browser — connects to it.

**If** the stack has to run beside the developer's own — the first question in
[§3](#3-environment-a-dedicated-environment-name-with-an-env-file-of-its-own) — it takes a
**port block of its own**. A stack that replaces the developer's rather than coexisting with it keeps
the conventional ports and skips this table; the loopback rules above still apply either way. The rows
are the example stack's components, and the pattern is one offset applied to every role your project
has:

| Role (example component) | Development | E2E stack | Note |
| --- | --- | --- | --- |
| system of record (database) | `127.0.0.1:3306` | `127.0.0.1:13306` | |
| cache and job queue (Redis) | `127.0.0.1:6379` | `127.0.0.1:16379` | |
| event transport (Kafka) | `127.0.0.1:29092` | `127.0.0.1:19092` | **published port must equal the port it advertises** |
| read model (search cluster) | `127.0.0.1:9200` | `127.0.0.1:19200` | |
| change propagation (Connect) | `127.0.0.1:8083` | `127.0.0.1:18083` | |
| edge (nginx) | `127.0.0.1:80` | `127.0.0.1:18080` | **the URL the hand-over prints** ([§5](#5-the-edge-what-the-browser-actually-connects-to)) |

**Keep the application's own port published as well**, even once the edge is in front of it. It is
what tells an operator whether a failure is the application's or the edge's, and it costs one line.
What changes is the hand-over: the URL the script prints is the **edge's**, because that is the path
production takes ([§5](#5-the-edge-what-the-browser-actually-connects-to)).

**The transport entry is the trap, and it generalizes.** Any service that answers a client with **its
own advertised address** — a broker handing back cluster metadata, a clustered queue redirecting to a
node name, a replica set naming its members — sends the client somewhere else after a connection that
looked fine. Remap the host side only and every subsequent operation fails. Keep host and container
port identical for such a service, and make sure the address it advertises is the one the host can
reach.

The stack also needs its **own compose project name**, or it adopts the development stack's
containers, network and volumes. Details, the full compose walk-through, and the per-service
settings the pipeline depends on are in [compose-definition.md](./references/compose-definition.md).

## 5. The edge: what the browser actually connects to

In production, the browser often reaches the product through a reverse proxy. Where it does, an
environment that lets the browser talk to the application directly **cannot catch any bug that
lives in the proxy** — and it still reports success. The operator sees a missing layer and a working
one as the same thing. That is the failure the rest of this skill exists to prevent.

So **where production has an edge, include one here by default**. It is a role like any other
([§1](#1-roles-first-the-component-set-here-is-one-example)).

**Where production has no edge, this section drops out**, the same as any other role the product
does not have. Do not add one just to be thorough. An environment with a layer production does not
have is wrong in the other direction, and it hides the same kind of bug — it would pass requests
through a proxy nobody runs in production.

Four rules:

- **Copy the configuration from production.** Start with the production file. Remove TLS
  termination. Point upstream at the E2E application. Do not write a new file: a new file has none
  of production's bugs, and finding those bugs is the only reason this section exists.

  **Where production's edge is a managed one — a cloud load balancer, an API gateway, a CDN — there
  is no file to copy.** Do not pretend otherwise. Pick the behaviours your product actually depends
  on (header forwarding, body size, timeouts, buffering), reproduce those in whatever proxy you run
  locally, and write down which ones you could not reproduce. The deployment runbook checks the
  rest after release. A local nginx standing in for an ALB is a useful rehearsal, not the same
  thing, and saying so is what keeps it useful.
- **Write down where the copy came from**, at the top of the file:

  ```nginx
  # derived-from: the deployment runbook's edge configuration chapter
  # derived-at:   2026-08-22
  # deltas:       TLS termination removed / upstream repointed to the E2E app
  ```

  When production changes, update `derived-at` and rewrite `deltas`. **A note nobody updated does
  not tell you this is a copy. It tells you the two files are now different.** If `deltas` keeps
  growing, the copy is turning into a rewrite. Fix the production file so both can share more.
- **Keep the edge and the application on the same side of the container boundary.** Put both in
  containers, or neither. If a check depends on the client's **source address**, put the client on
  that side too. A published port rewrites the source address, so moving only the application does
  not help.
- **Check the edge from the side that uses it.** A healthcheck inside the container only sees the
  inside. It reports healthy even when nothing outside can reach the edge. The same holds for
  waiting, for reachability and for acceptance — not just for healthchecks.

Two shapes follow the boundary rule. Mixing them does not work:

```
A — the edge is part of what you are checking
  [client container ×N] → [edge container] → [app container]
  one compose network, and the source addresses are really different

B — no edge
  [browser on the host] → [app process on the host]
  nothing checks the proxy layer
```

**Shape B is a fair choice. Choosing it in silence is not.** A demo, a deadline, or a machine the
edge will not run on are all good reasons. Each one still needs a note: what you measured, what you
decided, and who checks it instead — usually the deployment runbook. Also, do not leave a broken
edge config and a spec that always fails. A run that is red every time hides the real failures.

**Say exactly what a check proves.** Testing the edge without the application behind it proves the
edge's own configuration. It proves nothing about how the two work together. Round that up in your
notes, and six months later someone reads it as "we tested the whole thing".

The compose service, the nginx configuration, the Apache equivalents, how to make the copy, and what
we measured when the boundary was crossed are all in
[edge-and-proxy.md](./references/edge-and-proxy.md).

## 6. Data: a seed set of its own

The environment gets **two seeder directories of its own**, seeded by their own scripts:

| Directory | Holds | Corresponds to |
| --- | --- | --- |
| `sequelize/seeders/<stack-env>-master/` | the master / metadata rows the stack needs, **re-exported** from the production master | the dev-master set |
| `sequelize/seeders/<stack-env>/` | the operational rows the environment is filled with, and that a session mutates | the development set |

- **Why separate from the unit-test fixtures.** The two sets serve opposite needs — this environment
  wants a small, pipeline-shaped set that flows end to end, a unit test wants exhaustive branch
  coverage. Sharing one set means every change to satisfy one silently re-tunes the other, and a
  broken unit test is then a puzzle. Separate directories make ownership obvious.
- **The master set is re-exported, never copied.** Rows whose ids end up **inside a derived
  artifact** (an id written into a read-model document, a key a mapping is built from) must be
  **identical in every environment**, or a read model built here cannot be compared with one built
  anywhere else. A one-line `module.exports = require('../<production-master-dir>/<same-name>.cjs')`
  keeps them the same by construction.
- **Ids come from a reserved band of their own** — the same 10,000-wide blocks the project's seeder
  convention already uses, set above every block the other sets use — so a row's origin is readable
  from its id and the two sets cannot collide even if both are somehow applied.
- **Seeds insert rows, not files.** A row that claims a stored file whose bytes are absent answers
  404 on the screen that opens it, which reads as a product bug — so the build also **generates the
  binary artifacts the seeds promise**, as a step of its own.
- **Sign-in has to be possible.** The set includes the accounts the operator signs in with;
  obviously-fake, development-grade, and committed like any other seed row.

The directory layout, the re-export skeleton, the id band, the generated-artifact step and how to
keep the set pipeline-shaped are in [seed-data.md](./references/seed-data.md).

## 7. The runner: one command per intention, and no script that guesses

```bash
e2e/up.sh                 # rebuild: clean, start, seed, hand over — the from-nothing path
e2e/up.sh --start-only    # start without touching data at all (exactly what start.sh does)

e2e/start.sh              # bring the stack and the processes up. no data operation
e2e/seed.sh               # load the seed set into a stack that is already up
e2e/clean.sh              # delete the data in every store
e2e/down.sh               # stop the processes and the stack, keep the data
```

The scripts sit at the root of `e2e/` and point at the definition with
`-f e2e/docker/compose.yaml`, so the operator never has to be in a particular directory to run them.

**No script inspects the data to decide what to do.** This is the rule the lifecycle is built around,
and it is worth more than any convenience a detection step could buy. A script that checks whether
the environment "looks seeded" has to define what that means, keep a record of it somewhere, and
guess wrong at the worst moment — a half-finished load looks loaded, a hand-emptied table looks
fresh. Every one of those states then needs its own branch, and the branches are invisible until one
misfires. **The operator knows which of the four things they want; the command they type says so, and
the script does exactly that and nothing else.**

Three consequences follow:

- **`up.sh` is a composition, not a fifth behaviour.** It runs `clean.sh`, then `start.sh`, then
  `seed.sh`. Typing it *is* the request to rebuild from nothing, so it drops without asking — that is
  what the word means. `--start-only` delegates to `start.sh` unchanged; there is no third path
  through the code and no flag that half-rebuilds.
- **There is no "skip the drop but still seed" mode**, because seed rows carry fixed ids and applying
  the set onto rows that already exist collides on insert. The two useful intentions are *rebuild*
  and *start*, and both have a command.
- **A collision is a correct answer, not a bug to design around.** `seed.sh` run twice fails loudly
  and says the set is already there. Do not make the seeders idempotent to smooth this over: the
  failure is the environment telling the operator they meant `up.sh`, and hiding it costs more than
  it saves.

**`clean.sh` deletes every store in the same run, or it is worse than not cleaning.** Data lives in
more places than the system of record: the read model holds documents, the transport holds retained
messages and consumer offsets, change propagation holds its own offsets or slot, object storage holds
generated files, the queue holds jobs. Drop the schema alone and the read model still answers with
documents whose rows no longer exist — a screen that shows deleted data reads as a product bug. Stop
the processes **first**, or a running consumer repopulates what you are deleting while you delete it.

**Where a step goes is decided by whether it depends on data.** `start.sh` owns provisioning that does
not: creating the read model, creating the transport's channels. `seed.sh` owns the schema, the rows,
the generated artifacts, the backfill — and any provisioning **derived from data**, which in the
example is registering the capture connector, since its table list comes from the master rows. Put a
data-derived step in `start.sh` and starting an empty environment fails for a reason that has nothing
to do with starting.

The order inside each script is **dependency, not preference**: the transport's channels have to exist
before anything produces to them, because properties like a partition count cannot be reduced later;
the read model has to exist before anything is written into it; the metadata has to be in the system
of record before data-derived propagation can be told what to watch. The per-script step tables, and
what `clean.sh` has to reach, are in [runner-and-lifecycle.md](./references/runner-and-lifecycle.md).

Four properties of the scripts matter more than the steps:

- **Waiting is on healthchecks, never on `sleep`.** Every service declares a healthcheck and the
  script polls it to a **deadline**, then reports which service never became healthy and the command
  that shows its log. A fixed sleep is a race that passes on a fast machine. **Poll from the side
  that will use the service** — a check run inside the container reports healthy while nothing
  outside can reach it ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- **The edge comes up last, once the application answers.** It has nothing to serve before then, and
  a proxy that starts first turns a slow application into a confusing 502. It holds no data, so
  `clean.sh` has nothing to do for it.
- **The application and the background processes are part of the environment.** Change events do not
  reach the read model because the middleware is up: the processes that carry them — in the example a
  **worker daemon** and a **change-log consumer** — have to be running, and the **application itself**
  has to be running for there to be a UI at all. The script starts all of them and records their PIDs.
- **A failed build stops the processes it started; it never cleans.** Trap on `EXIT` while building
  and clear the trap once the hand-over is printed, so a build that died at the propagation step does
  not leave half a stack behind — but the trap calls `down.sh`, **not** `clean.sh`. A failed build
  that also deleted the operator's data would be the worst outcome of all.
- **Finish by handing over.** The last thing the script prints is what the operator needs to start
  working: the URL to open, where the process logs are, whether data was loaded or kept, and the
  commands that stop and that wipe it. Where there is an edge, **the URL is the edge's**, because
  that is the path production takes; the application's own port stays published for triage. An
  environment nobody can find their way into is not finished.

## 8. Traps that let a half-built stack look finished

Each of these produces a stack that **starts cleanly and behaves wrongly** — the failure mode this
skill exists to prevent, because the operator will read it as a product defect. Written in the
example stack's components — the shape carries over
([§1](#1-roles-first-the-component-set-here-is-one-example)). The first two are the most common.

- **A remapped port on a service that advertises its own address** — connects, then fails on every
  operation afterwards (in the example, a broker whose advertised listener is stale)
  ([§4](#4-ports-are-published-to-loopback-only-on-a-dedicated-block)).
- **A derived name built from a stale identity** — in the example, a capture database name that no
  longer matches the database name, so the consumer subscribes to channels that will never receive a
  message. Nothing errors; nothing ever propagates
  ([§3](#3-environment-a-dedicated-environment-name-with-an-env-file-of-its-own)).
- **Propagation wired up after the data was loaded, with no backfill** — rows that existed *before*
  it was wired up are never captured, so everything seeded is missing from the read model while
  everything created afterwards appears. Backfill after seeding, or accept that only new rows exist.
- **A build step that fails without stopping the build** — the environment hands itself over
  incomplete. `set -euo pipefail`, and abort loudly.
- **A feature that needs a host-installed tool assumed present** — turn that feature off explicitly
  for the environment, so its absence is a decision rather than a mystery on screen.
- **Reusing the development stack's volumes** — the build inherits another stack's rows, and
  fixed seed ids collide on insert ([§4](#4-ports-are-published-to-loopback-only-on-a-dedicated-block)).
- **A clean that only reached the system of record** — the read model still answers with documents
  whose rows are gone, the transport still holds the old messages, and the screen shows deleted data.
  Clean every store in one command, processes stopped first
  ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).
- **A script that decides for itself whether to load** — a load that died halfway looks loaded, a
  hand-emptied table looks fresh, and the wrong branch is invisible until it misfires. Let the command
  the operator typed say what happens ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).
- **Seeders made idempotent so re-running is "safe"** — the id collision was the environment saying
  the set is already there, and smoothing it over trades a loud, correct failure for rows that quietly
  differ from the set ([§6](#6-data-a-seed-set-of-its-own)).
- **Background processes started by hand, or not at all** — the middleware is up, the screens work,
  and nothing propagates. Start them from the script ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).
- **No logs kept** — when something does not appear on screen, the answer is in the daemon's or the
  consumer's output, and a run that discarded it forces a rebuild to find out why.
- **No edge at all, where production has one** — every defect that lives in the proxy layer is
  invisible here and surfaces only in production: unforwarded `Upgrade` headers, the default body
  size limit, buffered streaming, a missing `X-Forwarded-For`. The full list, and what each looks
  like on screen, is in [edge-and-proxy.md](./references/edge-and-proxy.md) ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- **An edge configuration written from scratch instead of derived from production** — it shares no
  defect with the real one, so it detects none of them. The layer is present and proves nothing
  ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- **A derived configuration with no record of what it was derived from** — production moves, the
  copy does not, and nothing says so. By the time anyone looks, they are two unrelated files
  ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- **The edge and the application on opposite sides of the container boundary** — traffic crosses it
  twice, and the paths that appear to work are the ones that mislead ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- **A source-address check read as green when the addresses were collapsed** — traffic through a
  published port arrives with one rewritten source address, so a per-client rule passes even when
  the implementation counts every client as one ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- **Two test beds' results reported as one end-to-end result** — exercising the edge without the
  application behind it proves the edge's configuration and nothing about the seam. Recorded
  rounded up, it reads later as "verified end to end" ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- **A container started with no `mem_limit`** — it grows into whatever the machine has, so one
  uncapped service silently undoes the whole memory budget and the machine swaps or OOM-kills under a
  load the caps were supposed to prevent. Cap every container, and set each JVM service's heap to
  about half its cap — the heap flag alone is not a cap
  ([compose-definition.md](./references/compose-definition.md)).
- **JVM heap flags mistaken for the memory limit** — `-Xmx` bounds the heap only, off-heap and page
  cache push a JVM service to two-to-three times its heap, so a stack "sized" by heap flags alone
  uses far more than the flags suggest and exceeds the budget. Size with `mem_limit`, keep the heap
  near half of it ([compose-definition.md](./references/compose-definition.md)).
- **The stack left up while something heavy runs beside it** — the resident processes go on polling
  and caching, the heavy job (a parallel test suite above all) sizes itself as if the machine were
  idle, and the machine dies under the sum. The `mem_limit` caps bound the stack's *ceiling*, but
  the memory under that ceiling is still spent; neither side is at fault alone if the operator chose
  to run both at once without a budget. `down.sh` first, or budget for both
  ([§2](#2-where-the-e2e-environment-lives)).

## Finishing checklist

- [ ] Every component the product talks to is accounted for by role, and the ones the project does not have are deliberately absent rather than forgotten ([§1](#1-roles-first-the-component-set-here-is-one-example)).
- [ ] The whole environment is under `e2e/`, with the compose file and everything it references by relative path together under `e2e/docker/`, the scripts at the root, and the run's output (logs, storage) git-ignored ([§2](#2-where-the-e2e-environment-lives)).
- [ ] `npm run test` is completely unaffected — no test file was added under `e2e/`, and the unit suite still needs nothing but Node ([§2](#2-where-the-e2e-environment-lives)).
- [ ] Every service declares a `mem_limit`, each JVM service's heap is about half its cap, and the sum of all caps sits at a conservative slice of the memory the container runtime was given (~40%, so two stacks can be up at once — on Docker Desktop or WSL2 that is the VM's allocation, not the machine's) ([compose-definition.md](./references/compose-definition.md)).
- [ ] No heavy job (the parallel unit suite above all) is assumed to share the machine with the running stack — it runs after `down.sh`, or the stack's capped footprint is counted against its memory budget ([§2](#2-where-the-e2e-environment-lives)).
- [ ] Every published port is `127.0.0.1`-prefixed — on a block of its own if the stack coexists with the developer's — and services the host does not reach publish nothing ([§4](#4-ports-are-published-to-loopback-only-on-a-dedicated-block)).
- [ ] Any service that advertises its own address is published on the port it advertises ([§4](#4-ports-are-published-to-loopback-only-on-a-dedicated-block)).
- [ ] The stack has its own compose project name, so it cannot adopt the development stack's volumes ([§4](#4-ports-are-published-to-loopback-only-on-a-dedicated-block)).
- [ ] Where production has an edge, this environment has one too, and **every screen was driven through it** rather than against the application's own port ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- [ ] The edge configuration was **copied from the production one**, and carries the `derived-from` / `derived-at` / `deltas` record naming what was changed. Where production's edge is managed and has no file, the behaviours reproduced and the ones that could not be are written down instead ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- [ ] Header forwarding (`Upgrade` / `Connection`) and the request body-size limit were confirmed **by exercising them**, not by reading the configuration ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- [ ] The edge and the application sit on the **same side of the container boundary** ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- [ ] Any check that depends on the client's source address has the **client on that side too**, so the addresses are not collapsed by a published port ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- [ ] Reachability and health were confirmed **from the side that consumes them**, not from inside the container ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- [ ] If the edge was left out, the measurement, the decision and where the verification was handed to are written down — and what any partial test bed proves is recorded at that granularity ([§5](#5-the-edge-what-the-browser-actually-connects-to)).
- [ ] The stack runs under its own environment name (`live-local` is the recommendation) with its own committed `.env.<stack-env>` — a complete, standalone file in which no key is referenced, imported or generated out of another environment's file, even where the values coincide ([§3](#3-environment-a-dedicated-environment-name-with-an-env-file-of-its-own)).
- [ ] The coexist / must-not-destroy questions have been answered out loud, and the values they force are written in `.env.<stack-env>`; anything the compose file interpolates reaches compose via `--env-file` or the runner's exports ([§3](#3-environment-a-dedicated-environment-name-with-an-env-file-of-its-own)).
- [ ] If a build may not destroy what the developer has, the system of record's name, every derived name's identity, the read model's name and the object storage location are all the E2E stack's own — these are the failures that are silent ([§3](#3-environment-a-dedicated-environment-name-with-an-env-file-of-its-own)).
- [ ] Seed data is in the environment's own `<stack-env>-master/` + `<stack-env>/` directories, master rows **re-exported** from the production master, ids in the reserved band, and sign-in accounts included ([§6](#6-data-a-seed-set-of-its-own)).
- [ ] The build generates the binary artifacts the seeds promise ([§6](#6-data-a-seed-set-of-its-own)).
- [ ] Waiting is on healthchecks with a deadline, and any failure aborts instead of handing over ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).
- [ ] **Each script does one thing and none of them inspects the data to choose a branch**; `up.sh` is literally `clean.sh` → `start.sh` → `seed.sh`, and `--start-only` delegates to `start.sh` ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).
- [ ] `start.sh` performs no data operation, and every step in it is safe to run against an environment that is already up ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).
- [ ] Provisioning that depends on data is in `seed.sh`, not `start.sh` — otherwise starting an empty environment fails for an unrelated-looking reason ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).
- [ ] Nothing but `clean.sh` deletes data, and the abort trap calls `down.sh`, not `clean.sh` ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).
- [ ] `clean.sh` reaches **every** store — system of record, read model, transport channels and offsets, propagation state, queue, object storage — and stops the background processes before it starts ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).
- [ ] `seed.sh` run against an already-seeded environment fails loudly on the fixed ids rather than being made idempotent ([§6](#6-data-a-seed-set-of-its-own)).
- [ ] The application and every background process the product needs are started by `start.sh` and stopped by `down.sh`, with their output kept in `e2e/logs/` ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).
- [ ] Whichever script the operator invoked ends by printing the URL to open, the log locations, and the stop and wipe commands ([§7](#7-the-runner-one-command-per-intention-and-no-script-that-guesses)).
- [ ] The unit suite still passes untouched and `npm run lint` passes.

## Detail files

Every detail file uses the same example stack, whose components illustrate the roles in
[§1](#1-roles-first-the-component-set-here-is-one-example).

- [compose-definition.md](./references/compose-definition.md) — the whole compose file for the E2E
  stack, the per-service settings the pipeline depends on (row-image change log, transport listeners,
  read-model heap and security, baked-in plugins), the per-container `mem_limit` caps and the
  runtime-memory budget that sizes them, project naming, volumes vs `tmpfs`, and healthchecks
  (§2, §4)
- [edge-and-proxy.md](./references/edge-and-proxy.md) — the edge compose service, the nginx
  configuration and its Apache equivalents, how to derive the E2E file from the production one and
  record the derivation, the reduced test bed that exercises the edge alone and the propositions it
  does not cover, and the measured record of what happens when the container boundary is crossed
  (§5)
- [windows-runner.md](./references/windows-runner.md) — **opt-in, read only when Windows-native
  scripts are asked for**: the per-OS differences behind the assumptions above, why plain Windows
  does not run the `.sh` set, the intention-by-intention PowerShell mapping, the shape of the five
  `.ps1` scripts, and how to record what was actually verified
- [environment-and-ports.md](./references/environment-and-ports.md) — the dedicated environment name
  and how its standalone `.env.<stack-env>` is authored, the table of values that must differ per
  environment, the dotenv/`process.env` precedence rule with the merge that causes it, the
  host-vs-network address split, the port block, and the missing-key-reads-as-`null` behavior (§3, §4)
- [seed-data.md](./references/seed-data.md) — the master / fixture split of the environment's own
  seeder directories, the re-export skeleton, the reserved id band, the seed scripts, and the
  generated-artifact step (§6)
- [runner-and-lifecycle.md](./references/runner-and-lifecycle.md) — the command set, the rule that
  puts each step in `start.sh` or `seed.sh`, a step table per script with the reason each step sits
  where it does, `up.sh` as their composition, what `clean.sh` has to reach and in what order,
  health-wait shapes, application and background-process handling, the hand-over, the
  abort-on-failure trap, and the CI stance (§7, §8)
