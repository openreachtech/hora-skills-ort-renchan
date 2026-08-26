# Secrets (checks 12–15)

`.gitignore` coverage of env files, secrets in committed env files, hardcoded secrets in code, and
plaintext passwords in seed / fixture data. Referenced from [SKILL.md](../SKILL.md). **Mask every
secret value in the report.**

## 12. Env files covered by `.gitignore` (all variants)

A `.gitignore` with a bare `.env` line matches **only** a file named exactly `.env` — it does **not**
match `.env.development`, `.env.staging`, `.env.production`, `.env.local`, etc. Those variants stay
trackable and are easily committed with real secrets.

```bash
ls -a | grep -E '^\.env'                        # which env files exist on disk
git check-ignore -v .env .env.* 2>/dev/null     # prints the matching rule for each IGNORED file
git ls-files | grep -E '(^|/)\.env'             # env files TRACKED in git (should usually be only a template)
```

- **Important:** adding a pattern to `.gitignore` does **not** untrack a file that is already
  committed — `.gitignore` only affects untracked files. If an env file is already tracked, it must be
  removed from the index with `git rm --cached <file>` (and the secret rotated). Verify with
  `git ls-files`, not just by reading `.gitignore`.
- **FINDING (HIGH if the tracked file holds real secrets, else MEDIUM):** any `.env*` file with
  secrets is **tracked** or **not ignored**. Recommend a broad ignore (e.g. `.env*` with a
  `!.env.example` negation), `git rm --cached` for anything already tracked, and — if a secret was
  ever committed — rotating it and purging history.
- **PASS:** every secret-bearing env file is ignored; only a secret-free template is tracked.

## 13. No secrets in committed env files; secret-free template present

Committed env files (a template, or any per-env file that is tracked) must not carry real secret
**values**. Inspect key names and whether their values are populated — **do not echo the values**;
grep key names and mask.

```bash
# For each TRACKED env file (from check 12), list secret-bearing key NAMES only:
git ls-files | grep -E '(^|/)\.env' | while read f; do echo "== $f =="; \
  grep -oE '^[A-Za-z0-9_]+=' "$f" 2>/dev/null | grep -iE 'PASSWORD|SECRET|TOKEN|API_?KEY|PRIVATE|CREDENTIAL|_KEY|DSN|CONNECTION'; done
# For each such key, check ONLY whether a value is present, and MASK it, e.g.:
#   grep -E '^SOME_API_KEY=' <file> | sed -E 's/=.{0,4}.*/=****(masked)/'
```

- **FINDING (HIGH):** a real secret value sits in a committed env file. Recommend replacing it with a
  placeholder, moving the real value to an untracked file / secret manager, and rotating.
- **Best practice to recommend:** keep exactly one committed, **secret-free** template (e.g.
  `.env.example`) listing every required key with placeholder values, and source **all** real
  credentials for non-local environments from env / a secret manager — never commit them, and do
  not leave per-env files (`.env.staging`, `.env.production`) tracked.
- **PASS:** values are empty / obvious placeholders (`your-key-here`, `changeme`, `xxxx`), and a
  secret-free template exists.

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
  carry hardcoded `username` / `password`. Hardcoded credentials in a committed config file are a
  finding **even if they look like placeholders**, because they normalize the pattern; production
  credentials should come from env / a secret manager.
- **FINDING (HIGH real / MEDIUM placeholder):** a literal credential in tracked code / config.
  Recommend sourcing from env / a secret manager; rotate if real.
- **PASS:** credentials only ever come from `process.env` / a config facade.

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
