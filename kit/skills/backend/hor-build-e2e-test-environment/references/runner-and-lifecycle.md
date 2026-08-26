# The runner and the environment's lifecycle

The one command that builds the environment, loads it, starts everything and hands it to the
operator — its step order, the reason each step sits where it does, and how the environment is torn
down. Referenced from §7 and §8 of [SKILL.md](../SKILL.md). Commands are the recommended shape and
the script names are **illustrative examples**; adapt them to your project. `<stack-env>` stands for
the E2E stack's own environment name — `live-local` is the recommended name.

> **The steps are named after roles, illustrated by one example stack.** "Create the search index"
> means *create the read model*; "create the change-log topics" means *create the transport's
> channels*; "register the capture connector" means *start change propagation, however your project
> propagates*. A role the project does not have deletes its step and every step that depended on it;
> a role the example does not name (a mail catcher, an identity stub) adds one. What does **not**
> change is the **order** — and the reason column is why.

## The interface

```bash
e2e/up.sh                 # rebuild: clean.sh, then start.sh, then seed.sh
e2e/up.sh --start-only    # start without touching data at all (delegates to start.sh)

e2e/start.sh              # bring the stack and the processes up. no data operation
e2e/seed.sh               # load the seed set into a stack that is already up
e2e/clean.sh              # delete the data in every store
e2e/down.sh               # stop the processes and the stack, keep the data
```

Scripted, because the value of this environment is that **it is not assembled by hand**. Nine manual
commands in a README become eight commands run and one forgotten, and the forgotten one is usually
the channel creation — whose absence looks like a product bug on screen.

**Each command owns one intention, and its effect on the data is fixed:**

| Command | Stack | Data | Processes |
| --- | --- | --- | --- |
| `start.sh` | up | untouched | started |
| `seed.sh` | must already be up | **loaded** | untouched |
| `clean.sh` | taken down | **deleted, everywhere** | stopped first |
| `down.sh` | down | untouched | stopped |
| `up.sh` | rebuilt | **deleted, then loaded** | started |
| `up.sh --start-only` | up | untouched | started |

- **Nothing here inspects the data to pick a branch.** No script asks "is this already seeded", keeps
  a record of what it did, or reasons about a state it did not create. Such a check has to define what
  "seeded" means, store that definition somewhere outside the data it describes, and be wrong at the
  worst possible moment — a load that died halfway looks loaded, a hand-emptied table looks fresh.
  **The operator knows which of these five things they want.** The command they type says so.
- **`up.sh` is a composition, not a fifth behaviour.** It is `clean.sh` → `start.sh` → `seed.sh` and
  contains no logic of its own. Typing it *is* the request to rebuild from nothing, so it drops
  without asking — that is what building the environment means. `--start-only` runs `start.sh` and
  nothing else.
- **There is no "skip the clean but still seed" mode.** Seed rows carry fixed ids, so loading the set
  onto rows that already exist collides on insert. The two useful intentions are *rebuild* and
  *start*, and each has a command; anything between them is a request to corrupt the set.
- **`down.sh` is not a wipe.** Stopping and destroying are different intentions, and the operator who
  types `down.sh` at the end of the day means the first one. `clean.sh` is the only script that
  deletes, and deleting is all it does — not even the abort trap may call it.
- Nothing in this lifecycle is tied to `npm run test`, which builds nothing and starts nothing.

## Which script a step belongs to

**A step goes in `seed.sh` if it depends on data, and in `start.sh` if it does not.** That single rule
decides every borderline case, including the ones that look like infrastructure:

- Creating the read model and creating the transport's channels are **provisioning**: they describe
  shapes, not contents, so they belong to `start.sh` and run create-if-absent.
- Registering change propagation belongs to **`seed.sh` when its configuration is derived from data** —
  in the example the capture connector's table list comes from the master rows, so registering it
  before those rows exist produces a connector watching nothing. Where the configuration is static,
  it is provisioning and moves to `start.sh`.
- The backfill belongs to `seed.sh`: it is the step that puts *this load's* rows into the read model.
- Put a data-derived step in `start.sh` and `up.sh --start-only` on an empty environment fails for a
  reason that has nothing to do with starting — exactly the confusion this skill exists to prevent.

## The step order

The order within each script is dependency, not preference. Every step in `start.sh` is **safe to run
again**, so `start.sh` against a stack that is already up succeeds instead of half-failing; `seed.sh`
is written for a single application to an empty schema and is not re-runnable, by design.

### `start.sh` — the stack, the provisioning, the processes

| # | Step (role) | Example | Why here |
| --- | --- | --- | --- |
| 1 | start every service | `docker compose -f e2e/docker/compose.yaml up -d --build` | — |
| 2 | wait for **every** service's healthcheck | compose's own health status | a later step against a half-started service fails in a way that reads like a code bug |
| 3 | create the **read model** if absent | create the search index | must exist before anything writes into it — equally true of a materialized view or a denormalized table. Create-if-absent, never recreate: recreating would be a deletion, and deletions belong to `clean.sh` |
| 4 | create the **transport's channels** if absent | create the change-log topics | the transport does not auto-create, and **some channel properties (a partition count) cannot be reduced later** — so the channels must exist, in their final shape, before anything produces |
| 5 | register **change propagation**, if its configuration is static | register a connector whose watch list is fixed | after the channels, because it produces to them. If the configuration is derived from data, this step is not here — it is in `seed.sh` |
| 6 | start the background processes the product needs, recording their PIDs | the worker daemon and the change-log consumer | nothing propagates without them; the middleware being up is not enough. After the channels exist, or a subscriber exits on startup |
| 7 | start the **application** (and the UI's own server, if it is served separately), recording their PIDs | `npm run start` | there is no UI to operate until this runs |
| 8 | bring the **edge** up, once the application answers | the reverse proxy in front of the app | it has nothing to serve before then, and a proxy started first turns a slow application into a confusing 502. It holds no data, so `clean.sh` has nothing to do for it |
| 9 | wait until the edge answers **from the host**, then **print the hand-over** and clear the abort trap | poll the published edge port | starting is finished only when someone can actually open it — and only a poll from outside proves that |

Every step is idempotent, because `start.sh` runs against a stack that may already be up, may have
just been cleaned, or may hold a full session's data. It never learns which — it does not need to.

### `seed.sh` — the schema and everything that depends on it

| # | Step (role) | Example | Why here |
| --- | --- | --- | --- |
| 1 | verify the stack is up and healthy | the same health wait | seeding against a half-started store fails in a way that reads like a code bug. `seed.sh` **starts nothing**: if the stack is down it says to run `start.sh` |
| 2 | create the schema, with the **same collation settings as production** | create database | a different collation changes string comparison, and the environment then behaves unlike every other one |
| 3 | apply migrations | `sequelize-cli db:migrate` | before rows exist, and it is also what lets a long-lived environment follow the code |
| 4 | seed the **E2E master** set | `db:seed:<stack-env>-master` | the metadata is what later steps derive from: which tables are propagated, which fields are in the read model |
| 5 | seed the **E2E fixture** set | `db:seed:<stack-env>` | after master, because fixtures reference master ids |
| 6 | generate the binary files the seeds refer to | write stand-in files under the storage path | after seeding, because it reads the seeded rows |
| 7 | register **change propagation** when its configuration is **derived from data** | register the capture connector, whose table list comes from the master rows | after the master seeds, or it watches nothing |
| 8 | backfill the read model | reindex every row | propagation only carries changes made **after** it was wired up, so the rows just seeded are missing from the read model without this |

**`seed.sh` is written for one application to an empty schema.** Run against a schema that already
holds the set, it collides on the fixed ids and stops — which is the correct answer: the operator
meant `up.sh`. Do not add `IGNORE`, upserts or existence checks to make it survive that; smoothing it
over trades a loud, accurate failure for rows that silently differ from the set the file describes.

**Step 8 has an alternative worth knowing.** Some propagation mechanisms can load the existing rows
themselves — in the example, setting the capture's snapshot mode to *initial* instead of
*schema-only*, so seeded rows arrive through the pipeline rather than through a backfill. Prefer
whichever mode production runs, because an environment should exercise the path production uses; where
that is the change-only mode, the backfill step is not optional.

**The steps that move with the stack** are `start.sh` 3-5 and `seed.sh` 7-8: they exist because the
example has a read model fed asynchronously through a transport. A product whose read path is served
straight from the system of record drops all five, and what remains keeps its order.

### `up.sh` — the composition

```bash
# e2e/up.sh — no logic of its own beyond the flag
if [ "${1:-}" = '--start-only' ]; then
  exec e2e/start.sh
fi

e2e/clean.sh
e2e/start.sh
e2e/seed.sh
```

- **Clean before start, seed after.** `clean.sh` takes the stack down, so it has to run first;
  `seed.sh` needs the services healthy, so it has to run last. The order is forced, not chosen.
- **Seeding after the processes are already running is deliberate.** The consumer is up while the rows
  land, so the seeded data propagates through the real pipeline rather than only through the backfill
  — the environment exercises the path production uses, and the backfill at the end covers whatever
  was missed.
- **`--start-only` delegates rather than branching.** One `exec` and no duplicated steps: the flag
  cannot drift away from the script it stands for.

## Cleaning: every store, in one command, processes first

`clean.sh` exists so that deleting is something the operator *asks for*. What makes it hard is that
the data is not in one place:

| Role | What `clean.sh` has to remove | What is left behind if it is forgotten |
| --- | --- | --- |
| system of record | the schema and its rows | — |
| read model | the index / view / table and its contents | screens answer with documents whose rows are gone — **deleted data on screen, which reads as a product bug** |
| event transport | the channels, their retained messages, **and the consumer offsets** | the next run replays old change events, or the consumer resumes from an offset in a channel that was recreated |
| change propagation | the registered connector and its stored offsets / slot / cursor | propagation resumes from a position that no longer means anything, and captures nothing |
| cache and job queue | queued and delayed jobs | a worker starts and immediately processes jobs about rows that no longer exist |
| object storage | the generated files | orphan files accumulate, and a re-load's stand-ins mix with the previous run's |
- **A partial clean is worse than none.** Every row above describes a stack that starts cleanly and
  behaves wrongly. If the script cannot reach one of these stores, it must say so rather than report
  success.
- **Stop the processes first.** A consumer or worker still running while the stores are emptied
  repopulates them from the messages it is holding, and the environment ends up in a state neither
  clean nor loaded. `clean.sh` calls the same stop the `down.sh` path uses, then deletes.
- **Prefer dropping the volumes to emptying the stores one by one.** `docker compose down --volumes`
  cannot half-clean: it removes every store the compose file owns in a single operation. Per-store
  deletion through each service's API is faster on a big environment, but it is a list that has to be
  maintained as the stack grows — and the failure mode of forgetting an entry is silent. Whatever the
  mechanism, **anything outside the volumes still has to be removed explicitly**: the object storage
  directory on the host, and the process logs if they would otherwise mislead the next session.
- **Cleaning does not re-load, and does not restart.** `clean.sh` leaves nothing running and prints
  the two ways forward: `up.sh` to come back with the seed set, `start.sh` to come back deliberately
  empty.

## Waiting on health, never on sleep

```bash
COMPOSE_FILE=e2e/docker/compose.yaml   # the scripts always name the definition explicitly
HEALTH_ATTEMPT_LIMIT=90
HEALTH_ATTEMPT_INTERVAL_SECONDS=2

function waitForHealthy () {
  local service=$1
  local attempt=0

  echo -n "waiting for ${service} "

  # compose reports each container's own healthcheck result; this only watches it
  until [ "$(docker compose -f "${COMPOSE_FILE}" ps --format '{{.Health}}' "${service}")" = 'healthy' ]; do
    attempt=$((attempt + 1))

    if [ "${attempt}" -gt "${HEALTH_ATTEMPT_LIMIT}" ]; then
      echo ''
      echo "${service} did not become healthy. try: docker compose -f ${COMPOSE_FILE} logs ${service}" >&2

      exit 1
    fi

    echo -n '.'
    sleep "${HEALTH_ATTEMPT_INTERVAL_SECONDS}"
  done

  echo ' ok'
}
```

- **A fixed `sleep 30` is a race**: it passes on a fast machine, fails on a loaded one, and wastes
  half a minute when everything was ready in five seconds.
- **Failing names the next command.** The message says which service and which log to read; a script
  that just says "timed out" makes every developer rediscover `docker compose logs`.
- **Whichever service is slowest sets the budget** — a search or database cluster that elects itself,
  usually. One limit generous enough for it is simpler than a per-service budget.

## The application and the background processes are part of the environment

Whatever processes actually move data — the worker daemon and the change-log consumer in the example,
an outbox poller or a scheduler elsewhere — plus the application itself, which is what there is to
operate. Start all of them from the script and own their lifetime:

```bash
# the script names are the example's; the shape — one line per process, PID appended — is the point
mkdir -p "${LOG_DIR}"

NODE_ENV=<stack-env> npm run job:daemon > "${LOG_DIR}/daemon.log" 2>&1 &
echo $! >> "${PID_FILE}"

NODE_ENV=<stack-env> npm run cdc:consumer > "${LOG_DIR}/consumer.log" 2>&1 &
echo $! >> "${PID_FILE}"

NODE_ENV=<stack-env> npm run start > "${LOG_DIR}/app.log" 2>&1 &
echo $! >> "${PID_FILE}"
```

- **Record the PIDs in a file, not just a shell variable.** `down.sh` is a different process from
  `up.sh` and has no other way to find them; a PID file under `e2e/` (git-ignored) is what connects
  the two.
- **Wait until each is actually working, not merely launched.** Poll for the readiness signal each one
  prints, or for its effect — a consumer group registered on the broker, the application answering on
  its port. A process that has started is not yet a process that has joined the group.
- **Capture their output to files.** When something does not appear on screen, the answer is in one of
  these logs; a build that discarded them forces a rebuild to find out why.
- **A subscriber cannot start before the channel it subscribes to exists** — in the example the
  consumer exits complaining that the broker does not host the topic-partition. If `start.sh` step 4
  was skipped, this is where it shows up, whatever the transport is.

## Hand over at the end

The last thing `start.sh` prints — and therefore the last thing `up.sh` prints — is what the
operator needs to start:

```bash
cat <<EOF

  the environment is up.

    open        ${APP_BASE_URL}
    logs        ${LOG_DIR}/{app,daemon,consumer}.log
    seed        e2e/seed.sh                  # loads the set into an empty schema
    stop        e2e/down.sh                  # keeps the data
    wipe        e2e/clean.sh                 # deletes it, everywhere

EOF
```

- **An environment nobody can find their way into is not finished.** The URL, the logs and the exits
  are the minimum; add whatever else a first-time operator would otherwise have to ask someone for.
- **Print the exits side by side, labelled by consequence.** `down.sh` and `clean.sh` differ only in
  whether the afternoon's work survives; a hand-over that lists one command called "tear down" invites
  the wrong one.
- **`start.sh` does not know whether there is data**, and does not try to find out — so it lists
  `seed.sh` as an available action rather than reporting a state. An operator looking at empty screens
  has the command right in front of them.
- **Say where the sign-in accounts come from** — they are seed rows ([seed-data.md](./seed-data.md)),
  so the hand-over only has to point at them, not restate them.

## Abort on failure, stay up on success

```bash
set -euo pipefail

function abort () {
  # only reached when start.sh did not complete.
  # stop what was started — never clean: deleting data is not this script's decision to make.
  e2e/down.sh
}

trap abort EXIT

# ... the start.sh steps ...

printHandover

trap - EXIT   # it succeeded: leave everything running
```

- **Trap while starting, clear the trap at the end.** A run that died at the provisioning step must
  not leave containers and Node processes behind for the next attempt to inherit — but a run that
  succeeded must leave exactly that, because that is the result.
- **The abort path stops; it does not wipe.** A failed run that also deleted the data would turn a
  recoverable problem into a lost afternoon. If `seed.sh` is what failed, the schema is left
  half-loaded and the operator is told so — `clean.sh` then `up.sh` is the way out, and it is their
  call, not the script's.
- **Without `-e`, a failed seeding step is followed by a hand-over of a half-loaded environment**, and
  the operator discovers it screen by screen. Without `pipefail` a failure inside a pipeline is hidden
  by the success of the last command.
- **`down.sh` stops the processes before the containers.** A worker whose queue vanished spends its
  shutdown retrying a connection and produces a page of noise around the real failure.
- **`down.sh` keeps the volumes; `clean.sh` is what drops them.** That is what makes `start.sh` after
  a `down.sh` return the operator to the environment they left. `clean.sh` is also the answer when a
  container-level thing (the database's init directory, the broker's stored connector config) needs
  rebuilding, because those only re-run on volume creation.
- **Read connection values out of the env file** rather than restating them in the scripts: two places
  saying different things is how a setup script rots. Read the key, fall back to a documented default.

## The CI stance

**This is a developer's environment, not a pull-request check.** A stack of containers, an image build
and a real propagation wait turn a two-minute check into a long one, and the failure modes (a slow
runner, an image registry hiccup) are not about the code.

- Keep the fast check exactly as it is: the unit suite on the local file database. Nothing in `e2e/`
  is discovered by it, so this environment cannot slow that workflow down or make it need Docker.
- If a scheduled job is wanted, let it run **`clean.sh`, `up.sh`, then `down.sh`** in a workflow of its
  own — the signal is "the environment still builds *from nothing*", which is worth having daily, not
  hourly. CI is the one place that should always start clean, because there is no operator's state to
  protect there.
- CI runs the same scripts. That is the point of having them: the environment CI builds is the
  environment a developer builds.
