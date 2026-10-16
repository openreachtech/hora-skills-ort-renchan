# Authorization & identity storage

Two tables hold what an OIDC sign-in adds to the cluster `/hor-cookie-authentication` builds. For an actor `<Actor>`:

- `<Actor>OidcAuthorization` (`<actor>_oidc_authorizations`) is one pending sign-in: the values the callback needs and the browser never holds.
- `<Actor>OidcIdentity` (`<actor>_oidc_identities`) is the permanent link from a provider's account to the actor.

Each is a normal renchan model (`/hor-sequelize-model`) with a create-table migration (`/hor-sequelize-migration`). This reference is only the OIDC-specific shape. Neither table takes the backup mixin: an authorization is deleted after use, and an identity is added or removed, never rewritten.

## The authorization row

```js
// <Actor>OidcAuthorization.createAttributes
state: {
  type: DataTypes.STRING(191),
  allowNull: false,
  unique: true,
},
nonce: {
  type: DataTypes.STRING(191),
  allowNull: false,
},
codeVerifier: {
  type: DataTypes.STRING(191),
  allowNull: false,
},
usedAt: {
  type: DataTypes.DATE,
  allowNull: true,
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

- `state` is the lookup key, so it carries the unique index. All three random values come from `crypto.randomBytes(32)` encoded as base64url, which is 43 characters.
- `codeVerifier` is a secret that is useless without the matching code and expires with the row. Store it as it is, and prune spent and expired rows on a schedule (`/hor-renchan-job-bullmq`).
- The row takes no `redirect_uri` column: the redirect URI is configuration, the same for every authorization.

State reads live on the model, as they do on the refresh token, so a resolver never re-implements the rules:

```js
isAvailable ({ pointsAt }) {
  return this.get('usedAt') === null
    && this.isUnexpired({ pointsAt })
}
```

`isUnexpired()` reads true while `expiredAt` is still ahead of `pointsAt`, so the caller never negates a predicate.

Spending the row is one update guarded on `usedAt: null` and on `expiredAt` still ahead. Zero rows updated means the row is missing, spent or expired, and the callback fails as an unusable authorization:

```js
static async spend ({
  state,
  now,
  transaction,
}) {
  const [spentCount] = await this.update({
    usedAt: now,
  }, {
    where: {
      state,
      usedAt: null,
      expiredAt: {
        [Op.gt]: now,
      },
    },
    transaction,
  })

  return spentCount === 1
}
```

## The identity row

```js
// <Actor>OidcIdentity.createAttributes
<Actor>Id: {
  type: DataTypes.BIGINT,
  allowNull: false,
},
issuer: {
  type: DataTypes.STRING(191),
  allowNull: false,
},
subject: {
  type: DataTypes.STRING(255),
  allowNull: false,
},
email: {
  type: DataTypes.STRING(191),
  allowNull: true,
},
linkedAt: {
  type: DataTypes.DATE,
  allowNull: false,
},
```

- **A unique index on (`issuer`, `subject`)** makes the pair the lookup key and makes a second link for one provider account impossible. Index `<actor>_id` as well. As elsewhere, the foreign key is a plain `BIGINT` with no DB-level `references`.
- `subject` takes 255 characters because that is the ceiling the OpenID Connect specification sets for `sub`. The issuer and subject columns stay under the key length your database allows for the composite index.
- `email` is what the provider reported at link time, kept for display and for the first-link match. It is never a lookup key afterwards.

## First link

A sign-in whose `(issuer, subject)` has no identity row takes one of two paths, and the app picks one per actor:

- **Provision.** Create the actor and its identity in one transaction. This is "sign up with the provider", and the profile fields come from the token's claims.
- **Match a pre-registered actor.** Find the actor by the token's `email`, and only when `email_verified` is `true`. Write the identity row in the same transaction. Every later sign-in finds the identity and never reads the email again.

A token with no matching identity and no permitted path raises `OidcAccountNotLinked`. The cookie skill's `signUp` has no role here: the provider is the only place an account is created.
