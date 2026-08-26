# Auth & transport (checks 6–11)

Authentication / authorization on every endpoint, the public allow-list, datastore transport
encryption, introspection / debug endpoints, CORS scope, and rate limiting. Referenced from
[SKILL.md](../SKILL.md).

The right patterns depend on the stack. First identify: the HTTP framework (Express / Fastify / Koa /
Nest / Hapi …), whether there is a GraphQL server (Apollo / Yoga / Mercurius / a framework
integration), and how the project expresses "this endpoint is authenticated" (middleware, guard,
decorator, a per-operation filter, an allow-list of public operations). Then adapt the checks below.

## 6. Auth enforced on every endpoint

The goal: **every route and every GraphQL operation is authenticated by default**, and the set of
operations reachable **without** auth is small, explicit, and intentional. Two enforcement models are
common — identify which the project uses:

- **Default-deny** (a global guard / filter authenticates everything; a named allow-list enumerates
  the public operations). Verify the guard is actually wired, and audit the allow-list (check 7).
- **Per-endpoint opt-in** (each route/resolver attaches its own auth middleware / guard). Verify none
  are missing it — the failure mode here is a forgotten guard.

### HTTP routes

```bash
# How auth is expressed (adapt keyword to the project): middleware, guard, decorator, visa, policy:
git grep -nE "authenticate|requireAuth|isAuthenticated|ensureAuth|@UseGuards|AuthGuard|passport|verifyToken|visa" -- '*.js' '*.ts' '*.cjs' | head
# Enumerate routes so you can cross-check each has auth (adapt to the router style):
git grep -nE "\.(get|post|put|patch|delete)\(\s*['\"]/|route\(|@(Get|Post|Put|Patch|Delete)\(|routePath" -- '*.js' '*.ts' '*.cjs'
```

- **FINDING (HIGH):** a route exposing sensitive data / actions with no auth middleware / guard.
- **FINDING (MEDIUM):** a route whose auth status is ambiguous (no clear guard, not an intentional
  public route).
- Public routes (health check, an integration webhook, a public form submit) must be **intentional**
  and otherwise protected (signature verification, IP allow-list, token, captcha).

### GraphQL — queries, mutations, **and subscriptions**

Subscriptions are frequently forgotten: a project may authenticate queries/mutations over HTTP yet
leave the WebSocket subscription transport (`onConnect` / connection init) unauthenticated. Check all
three operation types.

```bash
# The enforcement point (adapt to the server): a context builder, a global validation rule, a filter:
git grep -nE "authorize|isAuthorized|isAllowed|checkPermission|hasPermission|Unauthenticated|Unauthorized|requireAuth|context\s*:.*auth" -- '*.js' '*.ts' '*.cjs' | head
# Subscription transport auth (the commonly-missed one):
git grep -nE "onConnect|connectionParams|context.*subscription|subscriptions\s*:|useServer|SubscriptionServer" -- '*.js' '*.ts' '*.cjs'
# Enumerate operations to cross-check coverage (adapt to how schemas/resolvers are declared):
git grep -nE "type (Query|Mutation|Subscription)|@(Query|Mutation|Subscription)\(|static get schema" -- '*.js' '*.ts' '*.cjs' '*.graphql'
```

- **FINDING (HIGH):** the auth check is missing entirely (everything becomes public), or the
  subscription transport authenticates on connect differently from (or weaker than) queries/mutations.
- **FINDING (HIGH):** a **state-changing mutation** reachable unauthenticated that is not an
  intentional public operation.
- **FINDING (MEDIUM):** an operation whose coverage is ambiguous (neither clearly guarded nor an
  intentional public entry).

## 7. Public / guest allow-list is minimal & intentional (classified)

If the project has an explicit list of unauthenticated operations / routes, enumerate it and
**classify every entry**, because severity depends on what the operation does:

- **Read-only, non-sensitive** public entry (health check, public content query, public form submit)
  → likely intentional; confirm and mark INFO/PASS.
- **State-changing** public entry (any mutation that writes data) → **HIGH** unless there is a
  compensating control (signature, captcha, strict rate limit, idempotency). A public write is an
  abuse / spam / resource-exhaustion vector.
- **Sensitive read** (PII, internal data) exposed publicly → **HIGH**.

Report the **full allow-list** so a human can confirm each entry matches product intent. Flag any
entry that looks like leftover scaffolding rather than a deliberate public endpoint (see check 20).

## 8. Datastore transport encryption (TLS / SSL)

Connections to a managed / remote datastore should be encrypted in transit. For SQL via most ORMs /
drivers this is a TLS/SSL option on the connection config; for Mongo it is `tls=true` /
`mongodb+srv`; for Redis it is a `rediss://` URL / `tls` options.

```bash
# Find the connection config the project uses (adapt filename):
git grep -lniE "dialect|connection|datasource|createConnection|new Sequelize|new Pool|MongoClient|createClient" -- '*.js' '*.ts' '*.cjs' | head
# TLS/SSL settings within it:
git grep -nE "ssl|tls|rejectUnauthorized|sslmode|rediss:|mongodb\+srv" -- '*.js' '*.ts' '*.cjs' '*.json' | head
```

- **FINDING (MEDIUM):** a **remote / non-local** environment (staging / production) connecting to a
  datastore with **no TLS/SSL** → traffic is unencrypted. Recommend enabling TLS and, where the
  driver supports it, verifying the server certificate (e.g. `rejectUnauthorized: true` rather than
  `false`, which accepts any cert — a weaker MEDIUM).
- **Severity nuance:** a **local test / dev DB** on loopback (e.g. a sqlite file or a localhost
  container) does not need TLS — mark **N/A** for that environment, but do not let a local exception
  hide a missing setting on the production connection.
- **PASS:** all non-local datastore connections use TLS with certificate verification.

## 9. Introspection / playground / debug endpoints disabled in prod

```bash
git grep -nE "introspection|playground|graphiql|ApolloServerPluginLandingPage|debug\s*:\s*true|NODE_ENV" -- '*.js' '*.ts' '*.cjs' | head
```

- **Make it actionable:** determine the **actual production value**, not just that the flag is
  mentioned. `introspection: true` unconditionally → MEDIUM. Gated on `NODE_ENV !== 'production'` (or
  a config flag that is off in prod) → PASS; note how it is gated. A landing page / GraphiQL served
  in production → MEDIUM.
- **FINDING (MEDIUM):** introspection or an interactive playground / debug console enabled in
  production. Recommend disabling in prod (keep it in development only).
- **N/A:** no GraphQL server.

## 10. CORS scoped (not wildcard in production)

```bash
git grep -nE "cors\(|Access-Control-Allow-Origin|origin\s*:|credentials\s*:\s*true" -- '*.js' '*.ts' '*.cjs' | head
```

- **FINDING (HIGH):** `origin: '*'` (or reflecting any `Origin`) **together with**
  `credentials: true` — this is an invalid-but-dangerous combination that browsers partly block yet
  often leaks in practice; at minimum it signals no origin control.
- **FINDING (MEDIUM):** wildcard origin in production for anything beyond truly public, credential-less
  content.
- **Concrete secure pattern to recommend** (adapt to the app's real domains): allow only the app's
  own base domain **and its subdomains**, plus localhost for the test / dev environment, driven from
  an env var rather than hard-coded — e.g. an `origin` function that accepts a request origin when it
  equals or is a subdomain of the configured base domain, or is a localhost origin, and rejects
  everything else. Requests with no `Origin` header (server-to-server, curl) can be allowed since CORS
  is a browser control. Do not reflect arbitrary origins.
- **PASS:** origins are an explicit allow-list / env-driven and not `*` in production.

## 11. Rate limiting on public endpoints (and not bypassable)

```bash
git grep -nE "rateLimit|rate-limit|express-rate-limit|RateLimiter|throttle|slow-down|limiter" -- '*.js' '*.ts' '*.cjs' | head
# Client-IP resolution — the common bypass:
git grep -nE "x-forwarded-for|X-Forwarded-For|req\.ip|trust proxy|trustProxy|remoteAddress" -- '*.js' '*.ts' '*.cjs' | head
```

- **Make it actionable:** confirm a limiter is (a) actually **applied** to the public / expensive
  endpoints (unauthenticated forms, login, upload, AI/LLM calls), not merely imported; and (b) keyed
  on a **trustworthy client identifier**. If the limiter keys on a **spoofable header**
  (`X-Forwarded-For`) without a correctly configured `trust proxy` setting, an attacker rotates the
  header to bypass it.
- **FINDING (MEDIUM):** no rate limiting on a public, abusable, or expensive endpoint.
- **FINDING (MEDIUM):** rate limiting keyed on a client-controlled header without a trusted-proxy
  configuration (bypassable). Recommend keying on the real peer address / a correctly trusted proxy
  chain.
- **PASS:** limiter applied to the relevant endpoints and keyed on a trustworthy identifier.
