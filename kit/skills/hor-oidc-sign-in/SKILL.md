---
name: hor-oidc-sign-in
description: "Sign an actor in through an external OpenID Connect identity provider on a renchan backend: the authorization code flow with PKCE, where state, nonce and the code verifier live, how the ID token is verified, and how the provider's subject links to an actor. Use when adding a 'sign in with' provider. Boundary: tokens, sessions and the refresh cookie follow the cookie authentication convention; a proxy that signs users in before the app, such as IAP, is not this flow."
metadata:
  author: OpenReachTech
  version: "2026.10.16"
---

# OIDC Sign-in (Backend)

Use this skill when an actor signs in at an external OpenID Connect identity provider (IdP) instead of with a password held by the app. The app is a **confidential client**: it holds the client secret, starts the flow, receives the authorization code, exchanges it, verifies the ID token, and links the provider's account to one of its own actors.

This skill ends at an **actor entity**. Opening the session from there is `/hor-cookie-authentication`, unchanged: `SessionClerk.saveSession`, the refresh-token cookie, and the access token in the response body. After sign-in, every request still authenticates by the access-token header, `renewAccessToken` still renews, and `signOut` still revokes. Nothing in this skill touches those. A proxy that signs the user in before the request reaches the app (IAP) has no code exchange and no session: see `/hor-restfulapi-architecture`, its `behind-iap` reference.

> Snippets use `<Actor>` for the role being signed in, as `/hor-cookie-authentication` does.

## The flow

Two public mutations bracket a trip to the IdP. The browser never sees the client secret, the code verifier or the nonce.

```
frontend            backend                                   identity provider
   | startOidcSignIn     |
   |-------------------->| create state, nonce, code verifier
   |                     | save the authorization row, set the state cookie
   |<--------------------| authorizationUrl
   | navigate ---------------------------------------------->| user signs in
   |<---------------------------------------- redirect to redirect_uri?code&state
   | signInWithOidc      |
   |  { code, state }    | state == cookie == row, row unused and unexpired
   |-------------------->| exchange code + code verifier + client secret ---->|
   |                     |<--------------------------------------- ID token --|
   |                     | verify the ID token, find or link the actor
   |                     | saveSession, refresh cookie, clear the state cookie
   |<--------------------| accessToken
```

A public mutation pair follows the precedent `/hor-graphql-server-engine` sets with its public operations. The alternative is a REST `GET` callback on the backend that answers with a redirect. Choose it only when no frontend page can receive the IdP's redirect. The renderer then answers with a redirect flusher and sets the cookies through the response `headers` (`/hor-restfulapi-architecture`), and the rules below hold unchanged.

## Rules that keep the flow safe

- **PKCE with `S256` on every authorization**, even though the app holds a secret. The `code_challenge` is the SHA-256 digest of the verifier, base64url-encoded without padding. The verifier is 32 random bytes from `crypto.randomBytes`, base64url-encoded.
- **`state` ties the callback to the browser that started it.** The backend writes it to a short-lived `HttpOnly` cookie and to the authorization row. `signInWithOidc` accepts the call only when the `state` argument, the cookie and a row all agree. Without the cookie, an attacker could hand a victim a callback link that signs the victim in as the attacker.
- **The authorization row is single use and expires in about ten minutes.** Spend it with one update guarded on `usedAt: null` and on `expiredAt` still ahead, as the refresh-token rotation guards its own, so a replayed or late callback updates nothing. Missing, used and expired rows all raise one error, so the response does not say which.
- **`nonce` travels inside the ID token.** Compare the token's `nonce` claim to the one stored in the row.
- **Verify the ID token before reading any claim from it** ([id-token-verification](./references/id-token-verification.md)). The code exchange happens over TLS straight from the IdP, but the signature check is still required, because the claims are what the app is about to trust.
- **`redirect_uri` is a configured value, never taken from the request**, and it matches the IdP's registration exactly. The same string goes into the authorization URL and into the token request.
- **Link an actor by `(issuer, subject)`, never by email alone.** `sub` is stable and an email address can change hands. A first sign-in may attach to a pre-registered actor by email only when the token carries `email_verified: true`, and only once: the identity row it writes is what every later sign-in finds.
- **Keep the IdP's tokens out of storage** unless the app calls the IdP's APIs on the actor's behalf. Signing in needs the ID token once, during the callback.
- **The client secret is read through the Share** (`share.env`), like every other env value ([environment](./references/environment.md)). Log neither the code, the verifier nor any token.

## Core

| Topic | Description | Reference |
| --- | --- | --- |
| Environment & config | The `OIDC_*` env vars, the discovery document, the state-cookie constant and the engine's public operations | [environment](./references/environment.md) |
| Authorization & identity storage | The two tables and their models: the single-use authorization row and the `(issuer, subject)` identity link | [storage](./references/storage.md) |
| ID token verification | `OidcIdTokenVerifier`: signature by `kid`, `iss`, `aud`, `exp`, `nonce`, and why the Share keeps it | [id-token-verification](./references/id-token-verification.md) |
| Resolvers | `startOidcSignIn` and `signInWithOidc`, wired to the session clerk and the cookie clerk | [resolvers](./references/resolvers.md) |

The token-endpoint call and the discovery and key fetches are an external API client (`/hor-external-api-client`). The IdP stand-in for local runs belongs to `/hor-build-e2e-test-environment`.
