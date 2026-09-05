# Dev-login seeder

Removing the sample actor domain also removes the seeder that let `npm run dev` sign in. An app that adds cookie auth needs a **development** seeder (the `development/` directory, not `master/`) that inserts at least one actor with a known password, so a developer — and the E2E sign-in flow — can log in. Write it with [[hor-sequelize-seeder]] for the mechanics (directory choice, id-block numbering, `TimestampSeedsSupplier`).

For one actor, the seeder inserts the whole credential cluster ([token-models](./token-models.md)):

- the entity row (`<actor>s`),
- its secret row (`<actor>_secrets`) with the sign-in `email`,
- its password-hash row (`<actor>_password_hashes`).

The stored `password_hash` **must be produced by the same enciphering `verifiesPassword` compares against** — insert a pre-hashed digest of a known dev password, not the plaintext, or the login never matches.

```js
// pseudo — one dev <actor> whose password is a known, obviously-fake dev value
// password_hash = <digest of 'password-dev-0001' via the project's Encipher>
// bulkInsert:
//   <actor>s                → id, ...
//   <actor>_secrets         → <actor>_id, email: '<actor>-dev-0001@example.com'
//   <actor>_password_hashes → <actor>_id, password_hash, saved_at
```

Keep every seeded value unique and obviously fake (the seeder convention). Do **not** seed tokens — access and refresh tokens are created by signing in ([session-clerk](./session-clerk.md)); the seeder only provides the credential to sign in with.
