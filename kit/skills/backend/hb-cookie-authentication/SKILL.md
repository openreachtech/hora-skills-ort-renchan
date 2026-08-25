---
name: hb-cookie-authentication
description: "Cookie-based authentication for a renchan backend, per actor: the credential and token models (password hash, access + rotating refresh tokens with reuse detection), the refresh-token HttpOnly cookie, the signIn / signUp / signOut / renewAccessToken resolvers, and the engine's public-operation policy. Use when adding cookie auth to an actor/role. Boundary: models, migrations and seeders follow their own conventions; this replaces the older access-token-only flow."
metadata:
  author: OpenReachTech
  version: "2026.08.18"
---

# Cookie Authentication (Backend)

Use this skill when adding cookie-based authentication to a renchan backend — storing an actor's credential and tokens, the sign-in / sign-out / renew operations, the refresh-token cookie, and deciding which operations are public.

An authenticated actor (a role such as `user`, `customer`, `admin`, or `tenant`) keeps its password as a hash and authenticates with two tokens: a short-lived **access token** the client sends as a header, and a long-lived **refresh token** kept in the DB and handed to the browser as an **HttpOnly cookie**. `signIn` issues both; `renewAccessToken` reads the cookie, rotates the refresh token (detecting reuse of a retired one), and returns a fresh access token; `signOut` revokes the series and clears the cookie. Only `renewAccessToken` and `signOut` authenticate by the cookie — every other operation authenticates by the access-token header.

You build this **per actor**, on top of the boilerplate's base classes — it is not shipped in the boilerplate; each app builds it for the actors its spec declares. Design the actor entity and its profile first with [[hb-database-design]] / [[hb-sequelize-model]]; this skill adds the credential, tokens, operations, and cookie to it. It says what the auth cluster contains and how the pieces fit — writing each piece follows its own convention ([[hb-sequelize-model]], [[hb-sequelize-seeder]], [[hb-mutation-resolver]], [[hb-type-interface]]), and the engine is [[hb-graphql-server-engine]].

> **This replaces the older access-token-only flow.** In the old flow the access token was the durable credential — stored on the client and sent on every request, with no refresh cookie. Here the access token is short-lived and held only in memory on the client; durability comes from the refresh cookie. Do not mix the two: when this skill applies, there is no long-lived access token. The frontend half is [[hf-cookie-authentication]].

> Snippets throughout use `<Actor>` for the role being authenticated — substitute your own (`Member`, `Operator`, `Account`, …). Not every app has a "customer"; the reference implementation these snippets are drawn from happens to use `Customer` and `Admin`.

## Core

| Topic | Description | Reference |
| --- | --- | --- |
| Environment & config | Step-by-step setup: the `cookie` dependency, the `AUTH_*` env vars + facade, the per-actor cookie-name constant, and the engine's refresh-token cookie config | [environment](references/environment.md) |
| Token & credential models | Per actor: the password-hash model and the access / refresh token models, with `sessionKey` rotation columns and the backup mixin | [token-models](references/token-models.md) |
| Migrations | The create-table migrations for the credential and token tables | [migrations](references/migrations.md) |
| Session clerk | `SessionClerk` — the injected orchestrator over the token tables (`saveSession` / `rotateSession` / `revokeSession` / `findRefreshToken`), returning throwable-save result objects | [session-clerk](references/session-clerk.md) |
| Refresh-token cookie | The HttpOnly cookie clerk and reading / setting the cookie in the GraphQL context | [cookie-context](references/cookie-context.md) |
| Auth resolvers | `signIn` / `signUp` / `signOut` / `renewAccessToken` — token issue, rotation, and reuse detection | [resolvers](references/resolvers.md) |
| Auth-filter policy | `schemasToSkipFiltering` + `generateFilterHandler` — which operations are public (cookie) vs header-guarded | [auth-filter](references/auth-filter.md) |
| Error codes | The `Unauthenticated` and `RefreshTokenReused` codes and where they are thrown | [error-codes](references/error-codes.md) |
| Dev-login seeder | A development seeder so `npm run dev` can sign in against real data | [dev-login-seeder](references/dev-login-seeder.md) |
