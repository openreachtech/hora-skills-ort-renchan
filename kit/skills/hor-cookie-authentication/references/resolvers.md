# Auth resolvers

Four mutations, all thin: each wires `SessionClerk` ([session-clerk](./session-clerk.md)) and `RefreshTokenExpressCookieClerk` ([cookie-context](./cookie-context.md)). Write them with [[hor-mutation-resolver]]; this reference is only the auth wiring. Both clerks are reached through getter seams (`SessionClerkCtor`, `RefreshTokenExpressCookieClerkCtor`) so tests substitute them.

## signIn

Verify the password, start a session, set the cookie **after** the write commits, return only the access token.

```js
const passwordHashEntity = await this.findPasswordHashByEmail({ email })

if (!passwordHashEntity) {
  throw this.errorHash.IncorrectSecret.create()
}

const isValidPassword = await passwordHashEntity.verifiesPassword({ password })

if (!isValidPassword) {
  throw this.errorHash.IncorrectSecret.create() // same code for wrong email or password
}

const result = await this.createSessionClerk()
  .saveSession({
    userId: passwordHashEntity.<Actor>Id,
    now: context.now,
  })

if (result.hasError()) {
  throw new Error(result.extractErrorMessage())
}

// Only after the transaction committed — a cookie for a rolled-back session would leave the
// client holding a refresh token no row backs.
this.createCookieClerk({ context })
  .saveRefreshTokenCookie({ refreshToken: result.credentialPair.refreshToken })

return {
  accessToken: result.credentialPair.accessTokenEntity.accessToken,
}
```

## renewAccessToken

Authenticate from the **cookie** (the access token is usually expired when this runs, so the op skips filtering — [auth-filter](./auth-filter.md)). Rotate; a **used** token presented again is a leak → revoke the series and report reuse.

```js
const refreshTokenEntity = await sessionClerk.findRefreshToken({
  refreshToken: cookieClerk.extractRefreshToken(),
})

if (!refreshTokenEntity) {
  cookieClerk.clearRefreshTokenCookie()

  throw this.errorHash.Unauthenticated.create()
}

if (refreshTokenEntity.isUsed()) {
  return this.handleReusedToken({ context, refreshTokenEntity }) // revoke series + RefreshTokenReused
}

if (!refreshTokenEntity.isAvailable({ pointsAt: context.now })) {
  cookieClerk.clearRefreshTokenCookie()

  throw this.errorHash.Unauthenticated.create()
}

const result = await sessionClerk.rotateSession({ refreshTokenEntity, now: context.now })
// ... on success: set the new cookie, return the fresh accessToken
```

## signOut

Authenticate from the cookie, revoke the whole series, clear the cookie. **Idempotent** — a missing or unmatched cookie still clears the cookie and returns success, because signing out is never an error.

```js
const refreshTokenEntity = await sessionClerk.findRefreshToken({
  refreshToken: cookieClerk.extractRefreshToken(),
})

const result = await this.revokeSeries({ context, refreshTokenEntity }) // null when nothing matched

if (result?.hasError()) {
  throw new Error(result.extractErrorMessage())
}

cookieClerk.clearRefreshTokenCookie()

return {
  isSignedOut: true,
}
```

## signUp

Creates the actor together with its secret (email) and password hash. The profile fields are the app's own design; the auth-specific part is enciphering the password into the password-hash table (the same enciphering `verifiesPassword` compares against — [token-models](./token-models.md)). It may start a session like `signIn`, or leave the actor to sign in afterward.

All four operations are public — they are listed in `schemasToSkipFiltering` ([auth-filter](./auth-filter.md)).
