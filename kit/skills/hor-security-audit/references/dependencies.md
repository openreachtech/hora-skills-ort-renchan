# Dependencies & install hygiene (checks 16–18)

Vulnerable packages, lockfile / version-pinning / registry-token hygiene, and reproducible installs.
Referenced from [SKILL.md](../SKILL.md).

First detect the package manager from the committed lockfile: `package-lock.json` → npm,
`pnpm-lock.yaml` → pnpm, `yarn.lock` → Yarn, `bun.lockb` → Bun. Use that manager's commands below.

## 16. No vulnerable dependencies (advisory audit)

```bash
# npm:
npm audit --omit=dev 2>/dev/null || npm audit 2>/dev/null    # registry metadata only; no repo upload
# pnpm:   pnpm audit --prod 2>/dev/null
# yarn:   yarn npm audit --environment production 2>/dev/null   (Berry)  |  yarn audit  (classic)
```

- **FINDING (severity = the advisory's):** report each **high / critical** advisory — package,
  installed version, advisory title, and the fixed version. Summarize moderate / low as counts.
- **Remediation guidance to include per advisory:**
  - If a non-breaking fix exists (patch / minor within the current range), recommend the manager's
    safe upgrade — e.g. `npm audit fix` (no `--force`), which respects semver ranges.
  - If the only fix is a **major** bump or requires `--force`, do **not** recommend applying it
    blindly — call it out as a breaking change needing a compatibility review and testing.
  - If the vulnerable package is transitive, recommend upgrading the parent, or a pin / override
    (`overrides` in npm, `resolutions` in Yarn, `pnpm.overrides`) as a stopgap.
- **PASS:** no high / critical advisories.
- If the audit cannot reach the registry (offline / private-registry auth), say so and mark the check
  **BLOCKED** rather than PASS.

## 17. Lockfile committed + version-pinning delay + no committed registry tokens

```bash
git ls-files | grep -E 'package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb'   # a lockfile must be tracked
cat .npmrc 2>/dev/null; cat .yarnrc.yml 2>/dev/null                                 # registry / install config
git grep -nE "min-release-age|minimumReleaseAge|_authToken|_auth=|npmAuthToken|NPM_TOKEN=" -- '.npmrc' '.yarnrc*' '*.npmrc'
```

- **Lockfile committed** — required for reproducible / clean installs (check 18). Missing lockfile →
  **MEDIUM**.
- **Version-pinning delay** — a cooldown before installing a just-published version weakens a class
  of supply-chain attacks (a malicious release pulled before it is caught). npm supports
  `min-release-age`; pnpm supports `minimumReleaseAge`. **Recommend ≥ 7 days** where the manager
  supports it. Missing / `< 7` → **LOW**.
- **No committed registry credentials** — a private-registry token (`_authToken`, `_auth`,
  `npmAuthToken`, an inline `NPM_TOKEN=`) committed in `.npmrc` / `.yarnrc.yml` is a **HIGH** finding;
  such tokens must come from env / CI, not the repo.
- **PASS:** lockfile tracked, cooldown set (where supported), no committed tokens.

## 18. Reproducible installs (clean / locked install, not mutating)

CI, container builds, and production installs should use the manager's **clean, lockfile-exact**
install — which fails if the lockfile is out of sync and does not mutate it — rather than a plain
install that can update the lockfile and pull unpinned versions.

| Manager | Reproducible install | Avoid in CI/build |
| --- | --- | --- |
| npm | `npm ci` | `npm install` / `npm i` |
| pnpm | `pnpm install --frozen-lockfile` | `pnpm install` (writable) |
| Yarn Berry | `yarn install --immutable` | writable `yarn install` |
| Yarn classic | `yarn install --frozen-lockfile` | writable `yarn install` |

```bash
# Where installs happen — CI workflows, scripts, containers, docs:
git grep -nE "npm (ci|i|install)|pnpm install|yarn install|--frozen-lockfile|--immutable" -- '.github/**' '*.sh' 'package.json' 'Dockerfile*' 'docker-compose*' 'docs/**' 2>/dev/null
```

- **FINDING (LOW/MEDIUM):** a mutating install used in CI, a container build, or a deploy / setup
  script where the clean/locked variant is appropriate. Local first-time-setup docs using a plain
  install are usually acceptable — note but don't over-flag.
- **PASS:** CI / build / deploy paths use the clean / locked install, and the lockfile is committed
  (check 17).
