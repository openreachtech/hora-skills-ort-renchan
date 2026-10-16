# Resolvers

Two mutations, both public ([environment](./environment.md)), both thin. Write them with `/hor-mutation-resolver` and declare them with `/hor-graphql-schema`; this reference is only the OIDC wiring. The session half reuses `SessionClerk` and the refresh-token cookie clerk from `/hor-cookie-authentication` through the same getter seams.

The authorization row goes through a small `OidcAuthorizationClerk` shaped like `SessionClerk`: each write self-resolves a transaction and returns a result object, so a failed save is `result.hasError()` and never a throw.

```graphql
type Mutation {
  startOidcSignIn: StartOidcSignInResult!
  signInWithOidc(input: SignInWithOidcInput!): SignInWithOidcResult!
}
```

## startOidcSignIn

Create the authorization, set the state cookie **after** the row commits, and return the URL the browser navigates to.

```js
const result = await this.createOidcAuthorizationClerk()
  .saveAuthorization({
    now: context.now,
  })

if (result.hasError()) {
  throw new Error(result.extractErrorMessage())
}

const { authorizationEntity } = result

this.createStateCookieClerk({ context })
  .saveStateCookie({ state: authorizationEntity.state })

return {
  authorizationUrl: this.createAuthorizationUrlBuilder({ context })
    .build({ authorizationEntity }),
}
```

The URL is the provider's `authorization_endpoint` plus these query parameters, built with `URLSearchParams` so every value is encoded:

| Parameter | Value |
| --- | --- |
| `response_type` | `code` |
| `client_id` | `OIDC_CLIENT_ID` |
| `redirect_uri` | `OIDC_REDIRECT_URI` |
| `scope` | `OIDC_SCOPE`, starting with `openid` |
| `state` | the row's `state` |
| `nonce` | the row's `nonce` |
| `code_challenge` | base64url of the SHA-256 digest of the row's `codeVerifier` |
| `code_challenge_method` | `S256` |

The mutation takes no argument from the client, so it has nothing to validate and nothing a caller can steer.

## signInWithOidc

The order of the checks matters: a cheap rejection comes before the network call, and the ID token is verified before any claim is read.

```js
const stateCookieClerk = this.createStateCookieClerk({ context })

if (stateCookieClerk.extractState() !== input.state) {
  stateCookieClerk.clearStateCookie()

  throw this.errorHash.OidcAuthorizationUnusable.create()
}

const spendResult = await this.createOidcAuthorizationClerk()
  .spendAuthorization({ state: input.state, now: context.now })

if (spendResult.hasError()) {
  throw new Error(spendResult.extractErrorMessage())
}

if (spendResult.isUnspent()) {
  stateCookieClerk.clearStateCookie()

  throw this.errorHash.OidcAuthorizationUnusable.create()
}

const claimHash = await this.verifyIdToken({
  context,
  code: input.code,
  authorizationEntity: spendResult.authorizationEntity,
})

const actorEntity = await this.findOrLinkActor({ claimHash, now: context.now })

const sessionResult = await this.createSessionClerk()
  .saveSession({
    userId: actorEntity.id,
    now: context.now,
  })

if (sessionResult.hasError()) {
  throw new Error(sessionResult.extractErrorMessage())
}

stateCookieClerk.clearStateCookie()

this.createCookieClerk({ context })
  .saveRefreshTokenCookie({ refreshToken: sessionResult.credentialPair.refreshToken })

return {
  accessToken: sessionResult.credentialPair.accessTokenEntity.accessToken,
}
```

- **`isUnspent()` names the purpose.** The result reads true when the guarded update touched no row, so the caller never negates a predicate.
- **The row is spent before the exchange.** An authorization code works once at the provider, and a row that stays spendable after a failed exchange would let the same state be tried again. A failed callback means the person starts over.
- **`verifyIdToken()`** exchanges the code at the provider's `token_endpoint`, then hands the returned `id_token` to `context.share.oidcIdTokenVerifier.verify({ idToken, nonce })`. The exchange is a form-encoded `POST` (`application/x-www-form-urlencoded`) carrying `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `client_secret` and the row's `code_verifier`. It goes through an external API client (`/hor-external-api-client`), so the provider's key names stay in its Payload and Capsule. Any verifier error becomes `OidcIdTokenInvalid`.
- **`findOrLinkActor()`** looks up the identity by `(issuer, subject)`, and on a miss takes the first-link path the actor allows ([storage](./storage.md)). The write and the actor lookup for a first link share one transaction.
- **The cookies change after the writes commit**, as in `signIn`: a refresh cookie for a rolled-back session would leave the client holding a token no row backs.

## Error codes

Three codes, spread over `super.errorCodeHash` in the resolver as the cookie skill does. The numbers are examples: take the next free ones in the app's hash.

```js
static get errorCodeHash () {
  return {
    ...super.errorCodeHash,

    OidcAuthorizationUnusable: '205.M004.001',
    OidcIdTokenInvalid: '205.M004.002',
    OidcAccountNotLinked: '205.M004.003',
  }
}
```

- **`OidcAuthorizationUnusable`** covers a state that disagrees with the cookie, a row that does not exist, a row already spent and a row that expired. One code, so the response never says which.
- **`OidcIdTokenInvalid`** covers a failed exchange and every verification failure, for the same reason. Log the underlying class name on the server.
- **`OidcAccountNotLinked`** is the one the frontend can act on: the provider vouched for the person, and the app has no actor for them. It shows a message, not a retry.

`Unauthenticated` stays reserved for the header filter and `renewAccessToken`.
