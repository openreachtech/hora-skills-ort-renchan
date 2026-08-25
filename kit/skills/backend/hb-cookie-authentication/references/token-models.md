# Token & credential models

An authenticated actor's credential and session live in a small cluster of tables, kept apart from the actor's profile. For an actor `<Actor>`:

- `<Actor>` — the entity (its profile fields are the app's own design; see [[hb-database-design]]).
- `<Actor>Secret` — the sign-in identifier (`email`), kept apart from the profile.
- `<Actor>PasswordHash` — the password digest; verifies a candidate password.
- `<Actor>AccessToken` — the short-lived token (15 min), sent on the `x-renchan-access-token` header.
- `<Actor>RefreshToken` — the long-lived token; stored only as a digest, delivered as an `HttpOnly` cookie.

Each is a normal renchan model ([[hb-sequelize-model]]); this reference is only the auth-specific shape.

## The rotation columns (refresh token)

`sessionKey` is the **series**; `usedAt` / `revokedAt` / `expiredAt` drive rotation and reuse detection. Only the **digest** is stored (`tokenHash`, unique) — a dump of the table is not a set of usable sessions.

```js
// <Actor>RefreshToken.createAttributes — the auth-specific columns
<Actor>Id: {
  type: DataTypes.BIGINT,
  allowNull: false,
},
tokenHash: {
  type: DataTypes.STRING(191),
  allowNull: false,
  unique: true, // the digest, never the token; the lookup key
},
sessionKey: {
  type: DataTypes.STRING(191),
  allowNull: false, // the series a rotation keeps
},
usedAt: {
  type: DataTypes.DATE,
  allowNull: true, // set when spent on rotation
},
revokedAt: {
  type: DataTypes.DATE,
  allowNull: true, // set on sign-out or reuse
},
generatedAt: {
  type: DataTypes.DATE,
  allowNull: false,
},
expiredAt: {
  type: DataTypes.DATE,
  allowNull: false,
},
```

`<Actor>AccessToken` mirrors this but has no `usedAt` / `revokedAt` (an access token is deleted, not flagged) and carries the `accessToken` value (unique) plus the same `sessionKey`.

## Store the digest, hand back the plaintext

The token models never store the plain token. `buildWithGeneratedAttributes` takes the plain refresh token and stores only its digest through `hashToken`; the plaintext is returned by the clerk for the cookie.

```js
static buildWithGeneratedAttributes ({
  userId,
  sessionKey,
  refreshToken,
  generatedAt,
  expiredAt = this.createExpiredAt({ generatedAt }),
}) {
  return this.build({
    <Actor>Id: userId,
    sessionKey,
    tokenHash: this.hashToken({ token: refreshToken }), // only the digest is persisted
    generatedAt,
    expiredAt,
    usedAt: null,
    revokedAt: null,
  })
}
```

## State reads live on the model

Availability and reuse are model methods, so a resolver never re-implements the rules:

```js
isUsed () {
  return this.get('usedAt') !== null // presented again after this ⇒ reuse
}

isAvailable ({ pointsAt }) {
  return !this.isUsed()
    && !this.isRevoked()
    && !this.isExpired({ pointsAt })
}
```

## Audience-neutral foreign-key read

The shared `SessionClerk` ([session-clerk](./session-clerk.md)) holds the token model without knowing the actor, so expose the concrete foreign key through `extractUserId()`:

```js
extractUserId () {
  return this.get('<Actor>Id') // the Admin model returns AdminId
}
```

## Password hash

`<Actor>PasswordHash` stores `passwordHash`, uses the backup mixin (history), and verifies a candidate through the enciphered compare — never a plain equality:

```js
static get Mixins () {
  return [BackupMixinModel]
}

static get BackupModel () {
  return this._.<Actor>PasswordHashesBk
}

async verifiesPassword ({ password }) {
  const passwordHash = this.get('passwordHash')

  if (!passwordHash) {
    return false
  }

  return Encipher.create()
    .compare(password, passwordHash)
}
```
