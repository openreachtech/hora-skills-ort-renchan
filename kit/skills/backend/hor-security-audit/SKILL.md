---
name: hor-security-audit
description: >
  Run a READ-ONLY, repo-wide security audit of a JavaScript/TypeScript (Node) project and produce
  a findings list — do not fix anything. Covers injection, missing or over-broad auth on HTTP
  routes and GraphQL operations, port and datastore exposure, secrets and env hygiene, dependency
  risk, CORS, rate limiting, logging/PII, uploads, and error leakage. Use when the user asks for a
  security check or audit of the codebase. For a diff-only review of pending changes, use
  /security-review.
---

# Security Audit

A **read-only checklist audit** of a Node (JS/TS) repository. The goal is to **check and list
places that could become vulnerabilities** — not to fix them. Work through every check, run its
detection commands, judge each against its finding criteria, and produce a single **findings
report**.

This skill is **stack-agnostic within the Node ecosystem**: it names common frameworks / ORMs /
loggers only as *examples*. Discover what the target project uses (read `package.json`, the entry
point, the config files) and adapt each check's patterns to it. Do not assume any specific file
layout — detect it.

## Rules (read first)

1. **Read-only. Never edit, never fix.** Only inspect, run non-mutating commands, and report.
   Suggest a remediation per finding as text, but do not apply it.
2. **Never print secret values.** When a check surfaces a credential, show the **key name and a
   masked value** (e.g. `API_KEY=abcd…(masked)`, or `****`). Never paste full tokens / passwords into
   the report or transcript.
3. **Do not exfiltrate.** No network calls that send repo contents anywhere. A dependency-advisory
   check against the registry (e.g. `npm audit`, which sends only package metadata) is fine; sending
   files is not.
4. **Every check must appear in the report** — as one or more findings, `PASS`, or `N/A` (with a
   one-line reason). A gap must never look like "not applicable".
5. **Detect, don't assume.** Before running a check, confirm which tools the project uses and where
   the relevant code lives. If a check's subject does not exist in this project, mark it `N/A`.

## How to run

First, **profile the project** (about a minute): read `package.json` (scripts, deps, `engines`,
`type`), find the server entry point and the config / env files, and identify the HTTP framework, the
ORM / DB driver, the GraphQL server (if any), and the logger. Then go category by category through
the [detail files](#checklist--detail-files). For each check: run the detection commands (adapted to
this project), decide PASS / FINDING / N/A, and record findings in the format below. Prefer
`git grep` so the search covers tracked source only (no `node_modules`, no build output). Finally,
print the **summary table** (every check → verdict) followed by the detailed findings, most severe
first.

## Finding format

```
### [HIGH|MEDIUM|LOW|INFO] <short title>   (check: <category>/<id>)
- Location: <file:line, or scope e.g. "the ORM connection config, non-local environments">
- Evidence: <masked snippet or command output>
- Risk: <why this is exploitable / what it exposes>
- Recommendation: <what to change — DO NOT apply it>
```

Severity guide: **HIGH** = exploitable now / secret exposed / unauthenticated sensitive access.
**MEDIUM** = weakens the security posture (no transport encryption, weak config, unrestricted upload
type). **LOW** = hardening gap. **INFO** = worth noting, not a vulnerability.

## Checklist & detail files

| # | Check | Detail file |
| --- | --- | --- |
| 1 | Injection (SQL / NoSQL / command) via raw/interpolated input | [code-safety.md](./references/code-safety.md) |
| 2 | `eval` / dynamic-exec code | [code-safety.md](./references/code-safety.md) |
| 3 | Malicious / obfuscated code or install hooks | [code-safety.md](./references/code-safety.md) |
| 4 | Exposed ports / bind address / datastore exposure | [network-and-logging.md](./references/network-and-logging.md) |
| 5 | Production logging via a redacting logger; no PII | [network-and-logging.md](./references/network-and-logging.md) |
| 6 | Auth enforced on every endpoint (routes + GraphQL queries/mutations/**subscriptions**) | [auth-and-transport.md](./references/auth-and-transport.md) |
| 7 | Public / guest allow-list is minimal & intentional (classified) | [auth-and-transport.md](./references/auth-and-transport.md) |
| 8 | Datastore transport encryption (TLS / SSL) | [auth-and-transport.md](./references/auth-and-transport.md) |
| 9 | Introspection / playground / debug endpoints disabled in prod | [auth-and-transport.md](./references/auth-and-transport.md) |
| 10 | CORS scoped (not wildcard in production) | [auth-and-transport.md](./references/auth-and-transport.md) |
| 11 | Rate limiting on public endpoints (and not bypassable) | [auth-and-transport.md](./references/auth-and-transport.md) |
| 12 | Env files covered by `.gitignore` (all variants) | [secrets.md](./references/secrets.md) |
| 13 | No secrets in committed env files; secret-free template present | [secrets.md](./references/secrets.md) |
| 14 | No hardcoded secrets in code / config | [secrets.md](./references/secrets.md) |
| 15 | No plaintext passwords / secrets in seed / fixture data | [secrets.md](./references/secrets.md) |
| 16 | No vulnerable dependencies (advisory audit) | [dependencies.md](./references/dependencies.md) |
| 17 | Lockfile committed + version-pinning delay + no committed registry tokens | [dependencies.md](./references/dependencies.md) |
| 18 | Reproducible installs (clean / locked install, not mutating) | [dependencies.md](./references/dependencies.md) |
| 19 | File-upload validation (type + content + size) | [application-surface.md](./references/application-surface.md) |
| 20 | No unused / scaffold / boilerplate operations exposed | [application-surface.md](./references/application-surface.md) |
| 21 | GraphQL query depth / complexity limits | [application-surface.md](./references/application-surface.md) |
| 22 | Error responses don't leak internals in production | [application-surface.md](./references/application-surface.md) |

## Additional checks worth proposing

Offer these when relevant (report as findings / PASS / N/A like the rest):

- **Secrets in git history** (not just the current tree) — scan `git log -p` for secret patterns and
  known key shapes; a secret that was ever committed must be rotated even if later removed.
- **Datastore auth in production** — DB / cache / queue require a password and are not on a public
  interface.
- **Cookie / session flags** (`httpOnly` / `secure` / `sameSite`) if cookies are used.
- **Runtime pinning** (`engines` set; no end-of-life Node version).
- **Mass-assignment** — endpoints spreading raw request input straight into a DB write.

## Output

End with: (1) the summary table (every check → verdict), (2) findings most-severe-first, (3) the
count by severity, and (4) a one-line reminder that nothing was changed. If asked, offer to hand
specific findings to a fix workflow — but this skill itself never modifies code.

Write the report in the language the reader is using, as the documentation convention requires of
any document generated for a reader.
