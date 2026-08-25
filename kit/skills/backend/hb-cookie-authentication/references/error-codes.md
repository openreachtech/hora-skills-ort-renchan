# Error codes

Two codes make the cookie flow legible to the frontend ([[hf-cookie-authentication]]), on top of the engine's standard hash. Codes follow the dotted `<class>.<id>.<seq>` convention, spread over `super.errorCodeHash` in the resolver.

```js
// RenewAccessTokenMutationResolver
static get errorCodeHash () {
  return {
    ...super.errorCodeHash,

    // This op skips filtering, so it raises Unauthenticated itself — reusing the engine's own
    // code so the client sees the same "sign in again" signal.
    Unauthenticated: '102.X000.001',

    RefreshTokenReused: '205.M003.001',
  }
}
```

- **`Unauthenticated` = `102.X000.001`** — the engine's standard code. Header-guarded operations get it from the filter ([auth-filter](./auth-filter.md)); `renewAccessToken` skips the filter, so it raises the same code itself when the refresh cookie is missing, expired, or unavailable.
- **`RefreshTokenReused` = `205.M003.001`** — a spent refresh token was presented again (a leak). `renewAccessToken` revokes the whole series and throws this; the frontend treats it as a hard sign-out, no retry.
- **`IncorrectSecret` = `202.M002.001`** — `signIn` throws this for a wrong email *or* password, one code for both so it never reveals which was wrong.

The engine's `standardErrorCodeHash` owns `Unauthenticated` / `Unauthorized` / `DeniedSchemaPermission` (all `102.X000.*`); the filter throws those for header-guarded operations, so the auth resolvers only add what is theirs.
