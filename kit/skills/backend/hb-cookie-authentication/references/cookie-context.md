# Refresh-token cookie

The refresh token reaches the browser only as an `HttpOnly` cookie, so no page script can read it. All cookie logic lives in `RefreshTokenExpressCookieClerk` (`server/graphql/contexts/tools/`), not on the context — the context stays a plain DTO. A session resolver builds a clerk from the `context` it receives in `resolve()`; every other resolver never touches it.

```js
const cookieClerk = RefreshTokenExpressCookieClerk.create({ context })

cookieClerk.saveRefreshTokenCookie({ refreshToken }) // sign-in / renew
cookieClerk.clearRefreshTokenCookie()                // sign-out, or not-found
const presented = cookieClerk.extractRefreshToken()  // renew / sign-out only
```

## Config comes from the engine

Cookie name, lifetime, `secure`, `sameSite`, `httpOnly` are read from the engine config the context carries, so they change in one place — the engine. The path is the engine's GraphQL endpoint, so the cookie stays off every other route.

```js
get refreshTokenCookieConfig () {
  return this.context.config.refreshTokenCookie
}

get refreshTokenCookiePath () {
  return this.context.config.graphqlEndpoint // cookie scoped to this endpoint only
}
```

The engine supplies that config per audience — the cookie name differs per actor ([auth-filter](./auth-filter.md) for where it is set):

```js
static buildRefreshTokenCookieConfig () {
  return {
    ...this.refreshTokenCookieConfig,
    name: REFRESH_TOKEN_COOKIE.<ACTOR>.NAME,
  }
}
```

## Clearing must match the write

Clearing presents the same attributes as the write, minus the lifetime. The write uses the attributes plus `maxAge`; clearing uses the attributes alone. A mismatch leaves the browser holding the original cookie, and the session appears to survive sign-out.

```js
buildRefreshTokenCookieOptionHash () {
  return {
    ...this.buildRefreshTokenCookieAttributeHash(), // httpOnly, secure, sameSite, path
    maxAge: this.refreshTokenMaxAgeMilliseconds,
  }
}
```

## Reading is not authenticating

`extractRefreshToken()` only reads the value. **Only `renewAccessToken` and `signOut` may treat it as a credential** — every other operation authenticates by the access-token header ([auth-filter](./auth-filter.md)).
