# Session clerk

`app/session/SessionClerk.js` is the single window over the token tables — every find / save / update / delete across the access and refresh token tables. Resolvers depend only on it and never touch the tables. The **token models are injected**, so both audiences share one implementation.

```js
const sessionClerk = SessionClerk.create({
  AccessTokenModel: <Actor>AccessToken,
  RefreshTokenModel: <Actor>RefreshToken,
})
```

## Throwable-save, result objects

Each public write self-resolves a transaction and returns a **result object** rather than throwing — a throw rolls the transaction back and comes back as `result.error`. Naming the error is left to the resolver.

- `saveSession({ userId, now })` → `SavingSessionResult` — starts a new series (access + refresh pair). `result.credentialPair` is `{ accessTokenEntity, refreshTokenEntity, refreshToken }`, where `refreshToken` is the plaintext for the cookie.
- `rotateSession({ refreshTokenEntity, now })` → `SavingSessionResult` — spends the presented refresh row (`usedAt`) and issues the next pair in the same `sessionKey`.
- `revokeSession({ sessionKey, now })` → `RevokingSessionResult` — revokes every refresh token in the series and deletes its access tokens.
- `findRefreshToken({ refreshToken })` → the row, looked up by digest, or `null`.

```js
const result = await sessionClerk.saveSession({
  userId,
  now: context.now,
})

if (result.hasError()) {
  throw new Error(result.extractErrorMessage())
}

// result.credentialPair.refreshToken → hand to the cookie clerk
// result.credentialPair.accessTokenEntity.accessToken → the response body
```

## Rotation detects reuse

Rotation spends the presented row guarded on `usedAt: null`, so presenting a spent row again updates nothing. The resolver reads `refreshTokenEntity.isUsed()` and treats a used row as a leak ([resolvers](./resolvers.md)). Revocation is keyed on `sessionKey`, so it takes down the whole series at once.

## Transactions and seams

Every write takes an optional `transaction`: pass one to join an outer transaction (the caller then decides rollback via `result.hasError()`), or omit it to self-resolve one here. The clerk builds tokens through a `SessionCredentialGenerator` (token, digest, session-key) defaulted in its factory — real callers get real behavior; tests substitute the injected models and the generator seam.
