# Code safety (checks 1–3)

Injection (SQL / NoSQL / command), dynamic code execution (`eval`), and malicious / obfuscated code
or install hooks. Referenced from [SKILL.md](../SKILL.md).

Commands below use `git grep` so the search stays on tracked source (no `node_modules`, no build
output). Adjust the patterns to the ORM / driver / framework the project uses.

## 1. Injection (SQL / NoSQL / command)

Most ORMs and query builders parameterize by default and are safe. Risk appears where a **raw query
is built with string interpolation / concatenation from untrusted input** (request body, query
params, headers, path params, GraphQL variables, message payloads).

```bash
# Raw SQL entry points (varies by library — include the ones the project uses):
#   node-postgres/mysql2: .query(  |  Sequelize: sequelize.query / literal( / QueryTypes
#   Knex: .raw(  |  Prisma: $queryRawUnsafe / $executeRawUnsafe  |  TypeORM: createQueryBuilder / .query(
git grep -nE "\.query\(|\.raw\(|\\\$queryRawUnsafe|\\\$executeRawUnsafe|literal\(|QueryTypes|createQueryBuilder" -- '*.js' '*.ts' '*.cjs' '*.mjs'
# The dangerous shape — interpolation/concatenation inside a raw query:
git grep -nE "\.(query|raw)\(\s*\`[^\`]*\\\$\{" -- '*.js' '*.ts' '*.cjs' '*.mjs'
git grep -nE "(WHERE|SELECT|INSERT|UPDATE|DELETE)[^\"'\`]*(\+|\\\$\{)" -- '*.js' '*.ts' '*.cjs' '*.mjs'
# NoSQL (Mongo) operator injection — raw request objects flowing into a filter:
git grep -nE "\.(find|findOne|updateOne|deleteOne|aggregate)\(\s*(req\.|request\.|input|variables|body|params|query)" -- '*.js' '*.ts'
```

- **Distinguish the source of interpolated values.** Interpolating a **constant** (e.g. a table name
  from a file-local constant in a migration) is not injection. Interpolating anything that traces
  back to **request input** (`variables`, `input`, `req`, `args`, `body`, `params`, `headers`) is.
- **NoSQL note:** passing a raw request object straight into a Mongo filter allows operator injection
  (`{ "$gt": "" }`), even without string building. Flag request objects used as query filters
  without validation / casting.
- **FINDING (HIGH):** a raw query whose interpolated / concatenated value comes from user input, or a
  request object used directly as a NoSQL filter. Recommend parameterized queries (placeholders /
  bind params), the ORM's safe builder, or validating + casting the input first.
- **FINDING (LOW/INFO):** raw query with only constant interpolation — note it, confirm the value
  cannot become input-derived.
- **PASS:** no raw queries, or raw queries use bind params / only constants; NoSQL filters are
  validated.

## 2. `eval` / dynamic-exec code

```bash
git grep -nE "\beval\s*\(|new Function\s*\(|vm\.(run|compile|Script)|require\(['\"]vm['\"]\)|from ['\"]vm['\"]" -- '*.js' '*.ts' '*.cjs' '*.mjs'
git grep -nE "child_process|execSync|spawnSync|\bexec\(|\bspawn\(|\bexecFile\(" -- '*.js' '*.ts' '*.cjs' '*.mjs'
```

- **FINDING (HIGH):** `eval(` / `new Function(` / `vm` run on any value that could be
  attacker-influenced; `child_process` exec/spawn with interpolated input (command injection — a
  shell string built from input is worse than an args array).
- **FINDING (LOW):** `child_process` with fully-static args (still worth noting).
- **PASS:** none found, or all uses are on static values.

## 3. Malicious / obfuscated code & install hooks

Look for code that decodes-then-executes, phones home, or runs during install.

```bash
# Install-time hooks (a common supply-chain foothold) — check root and any workspace package.json:
git grep -nE "\"(pre|post)?install\"\s*:|\"prepare\"\s*:|\"prepublish(Only)?\"\s*:" -- 'package.json' '**/package.json'
# Obfuscation / decode-then-run:
git grep -nE "Buffer\.from\([^)]*base64|atob\(|\\\\x[0-9a-f]{2}|fromCharCode|eval\(.*(atob|Buffer)" -- '*.js' '*.ts' '*.cjs' '*.mjs'
# Unexpected outbound network / curl|bash in scripts:
git grep -nE "curl .*\| *(ba)?sh|wget .*\| *(ba)?sh|https?://[^ '\"]+" -- 'package.json' '*.js' '*.ts' '*.cjs' '*.sh' | head
```

- **FINDING (HIGH):** an `install` / `postinstall` / `prepare` script that downloads or executes
  remote code; base64 / hex-decoded strings passed to `eval` / `Function`; outbound calls sending
  repo / secret data to an unknown host.
- **FINDING (INFO):** hard-coded external URLs — list them so a human can confirm each is expected
  (API endpoints, docs) and not exfiltration.
- **PASS:** no install hooks that fetch / execute; no decode-then-run; outbound hosts all expected.
- Also sanity-check recent history (`git log -p -n 50 -- package.json`) for unexpected additions to
  build / install scripts.
