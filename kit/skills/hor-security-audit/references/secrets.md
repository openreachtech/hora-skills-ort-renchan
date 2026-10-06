# Secrets (checks 12–15)

`.gitignore` coverage of env files, secrets in committed env files, hardcoded secrets in code, and
plaintext passwords in seed / fixture data. Referenced from [SKILL.md](../SKILL.md). **Mask every
secret value in the report.**

## 12. Production-facing env files covered by `.gitignore`

Env files fall on two sides of one line, and the check differs by side.

| Side | Files | May be tracked |
|---|---|---|
| **production-facing** | `.env`, `.env.production`, `.env.prod`, `.env.staging` | never. `.env.staging` is shared with a client at times, so it is held as production |
| **local** | every other per-environment file — `.env.development`, `.env.live`, `.env.live-local`, `.env.test` and their like | yes, holding only values that reach the local machine (check 13) |

A `.gitignore` with a bare `.env` line matches **only** a file named exactly `.env` — it does **not**
match `.env.production`, `.env.staging` or `.env.prod`. Those stay trackable and are easily committed
with real secrets.

```bash
ls -a | grep -E '^\.env'                        # which env files exist on disk
git check-ignore -v .env .env.* 2>/dev/null     # prints the matching rule for each IGNORED file
git ls-files | grep -E '(^|/)\.env'             # env files TRACKED in git — sort each onto its side
```

- **Important:** adding a pattern to `.gitignore` does **not** untrack a file that is already
  committed — `.gitignore` only affects untracked files. If a production-facing env file is already
  tracked, it must be removed from the index with `git rm --cached <file>` (and the secret rotated).
  Verify with `git ls-files`, not just by reading `.gitignore`.
- **FINDING (HIGH if the tracked file holds real secrets, else MEDIUM):** a production-facing env file
  is **tracked** or **not ignored**. Recommend ignoring each by name, `git rm --cached` for anything
  already tracked, and — if a secret was ever committed — rotating it and purging history.
- **A local env file that is tracked is not a finding here.** Tracking it is allowed; what it holds
  is judged in check 13.
- **PASS:** every production-facing env file is ignored and untracked.

## 13. Committed env files hold only values that reach the local machine

A tracked local env file (check 12) is allowed on a condition, so **every one is read, every time** —
this check is never skipped, and never answered from the file's name. Read each file, and report
values **masked**: whether a value is local is judged on its shape, and the report never echoes it.

| Allowed in a local env file | A finding wherever it sits |
|---|---|
| an endpoint on `127.0.0.1` or `localhost` — `http://localhost:3000` included | an external host |
| a placeholder credential — `user` / `password` and their like | a real staging or production endpoint |
| the connection of a CI or test database (`live`) | a key-shaped value — an API key, a token, a private key |

```bash
# For each TRACKED local env file (from check 12), list every key, whether it holds a value MASKED:
git ls-files | grep -E '(^|/)\.env' | while read f; do echo "== $f =="; \
  sed -E 's/=.+$/=****(masked)/' "$f"; done
# Hosts are the one value read in full, since locality is the point: any that is not local is a
# finding. Credentials inside a URL are masked first:
git ls-files | grep -E '(^|/)\.env' | xargs grep -nE '(HOST|URL|ENDPOINT|DSN)[A-Z_]*=' \
  | sed -E 's#://[^@/]*@#://****@#' \
  | grep -vE '=([a-z+]+://)?(\*\*\*\*@)?(127\.0\.0\.1|localhost)([:/]|$)'
```

- **An auditor told not to read env files reports this check as BLOCKED, never as passed.** The
  allowance in check 12 rests on this reading; without it, nothing says the file stayed local.
- **FINDING (HIGH):** a tracked local env file holds a value outside the allowed column — an external
  host, a real staging or production endpoint, a key-shaped value. Recommend moving the value to a
  production-facing file or a secret manager, and rotating it if it was real.
- **PASS:** every tracked local env file holds only allowed values.

## 14. No hardcoded secrets in code / config

Search source and non-env config for inline credentials and known key shapes.

```bash
# Inline credential assignments (exclude ones sourced from env / set to null):
git grep -nE "(password|passwd|secret|api_?key|apikey|access_?token|client_?secret|private_?key)\s*[:=]\s*['\"][^'\"]+['\"]" -- '*.js' '*.ts' '*.cjs' '*.json' '*.yml' '*.yaml' \
  | grep -viE "process\.env|env\.|= *null|: *null|placeholder|example|changeme|xxxx"
# Known provider key prefixes / private keys, anywhere in tracked files:
git grep -nE "AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----"
```

- **Pay special attention to connection / datastore config files** — per-environment blocks commonly
  carry hardcoded `username` / `password`. **A production or staging block takes its credentials from
  the environment**, and a literal there is a finding even if it looks like a placeholder, because
  it normalizes the pattern where it does harm.
- **The same line as check 13 holds outside env files.** A placeholder credential is not a finding
  where only the local machine is reached by it:

  | Not a finding | Why |
  |---|---|
  | the compose of local middleware whose ports are published on `127.0.0.1` only | nothing off the machine reaches it |
  | the config of a CI or test database | it holds test data, and is rebuilt from nothing |

  A port published on every interface (`3306:3306`, `0.0.0.0:…`) takes the compose out of the first
  row, and its credentials are a finding again.
- **FINDING (HIGH real / MEDIUM placeholder):** a literal credential in tracked code / config, outside
  the two rows above. Recommend sourcing from env / a secret manager; rotate if real.
- **PASS:** credentials come from `process.env` / a config facade, or are placeholders where only the
  local machine reaches them.

## 15. No plaintext passwords / secrets in seed / fixture data

Seed / fixture data that provisions accounts or reference data must not contain plaintext passwords
or secrets. Distinguish two cases:

- **Production / master seed data** (data that ships to real environments) must contain **no**
  credentials at all — production accounts are provisioned out-of-band, not seeded.
- **Development / test fixtures** may create login accounts, but any password must be **hashed**
  (through the app's real hashing path), never stored as plaintext that reaches the datastore.

```bash
# Locate seed / fixture directories (names vary: seeders, seeds, fixtures, factories):
find . -type d \( -iname 'seed*' -o -iname 'fixture*' -o -iname 'factories' \) -not -path '*/node_modules/*' 2>/dev/null
# Secrets in seed/fixture files (point at the dirs found above):
git grep -nE "password|passwd|secret|api_?key|token|raw_password" -- '*seed*' '*fixture*' '*factor*' | head
# Confirm dev fixtures hash rather than store plaintext:
git grep -nE "hash|bcrypt|argon2|scrypt|pbkdf2|password_hash" -- '*seed*' '*fixture*' | head
```

- **FINDING (HIGH):** a plaintext `password` / secret literal in production / master seed data.
  Recommend removing it (provision production credentials out-of-band).
- **FINDING (MEDIUM):** a dev / test fixture stores a plaintext password that reaches the datastore
  unhashed.
- **PASS:** production seeds hold only non-secret reference data; dev fixtures hash any password.
