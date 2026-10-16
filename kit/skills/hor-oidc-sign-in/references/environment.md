# Environment & config

Set these up once per project, before the resolvers. Steps:

## 1. Dependency

The ID token is verified with `jose` ([id-token-verification](./id-token-verification.md)), and the state cookie is written with the `cookie` package that `/hor-cookie-authentication` already installs. Add the first:

```
npm install jose
```

## 2. Env vars

The provider's identity and the app's registration with it are environment-driven, so they change per deploy with no code change. Add to each `.env.*`:

```
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=
OIDC_SCOPE=
```

Declare them on the env-facade typedef and read them **through the facade**, never `process.env` directly. Only the Share imports `env`, so every other class receives the values from `share.env` (`/hor-resolver-share`).

- `OIDC_ISSUER` is the issuer identifier exactly as the provider publishes it, including any trailing slash. It is compared to the `iss` claim as a string, so a slash that differs rejects every token.
- `OIDC_REDIRECT_URI` is one of the redirect URIs registered at the provider, character for character.
- `OIDC_SCOPE` starts with `openid`. Add `email` when the first-link step matches a pre-registered actor by email ([storage](./storage.md)).
- `OIDC_CLIENT_SECRET` is a secret: keep it out of committed env files. A local env file holds only the stand-in's placeholder (`/hor-build-e2e-test-environment`).

## 3. The discovery document

The provider publishes its endpoints at a well-known path under the issuer. `OidcProviderConfiguration` fetches that document **once, when the Share is created**, through an external API client (`/hor-external-api-client`), and exposes `issuer`, `authorizationEndpoint`, `tokenEndpoint` and `jwksUri`. It checks that the document's `issuer` equals `OIDC_ISSUER` and throws otherwise: a mismatch means the app is pointed at the wrong provider, and booting is better than signing anyone in against it.

The Share only creates what it keeps, through the other classes' factory methods:

```js
/** @override */
static async createAsync ({
  config,
}) {
  const env = this.generateEnv()
  const oidcProviderConfiguration = await OidcProviderConfiguration.createAsync({
    issuer: env.OIDC_ISSUER,
  })

  return this.create({
    env,
    oidcProviderConfiguration,
    oidcIdTokenVerifier: OidcIdTokenVerifier.create({
      clientId: env.OIDC_CLIENT_ID,
      providerConfiguration: oidcProviderConfiguration,
    }),
    // ...
  })
}
```

The Share keeps both instances because each outlives a request: the configuration is fetched once, and the verifier holds the key cache ([id-token-verification](./id-token-verification.md)). A resolver reads `tokenEndpoint` from `context.share.oidcProviderConfiguration`.

## 4. State-cookie constant

The state cookie has its own name, so it never collides with the refresh-token cookie of the same actor. Define it next to that one (`/hor-constant-definition`):

```js
// constants/authConstants.cjs
OIDC_STATE_COOKIE: {
  <ACTOR>: {
    NAME: '<actor>_oidc_state',
    MAX_AGE_SECONDS: 600,
  },
}
```

The cookie is written and cleared by a clerk shaped like the refresh-token cookie clerk (`/hor-cookie-authentication`): `HttpOnly`, the same `secure` and `sameSite` as that cookie, the same `path`, and a lifetime equal to the authorization row's. Clearing presents the same attributes as the write, minus the lifetime.

## 5. Public operations

Both mutations run before the actor has a credential, so list them in the engine's `schemasToSkipFiltering` next to the password operations (`/hor-graphql-server-engine`):

```js
get schemasToSkipFiltering () {
  return [
    'startOidcSignIn',
    'signInWithOidc',
    // ... the other public operations
  ]
}
```

## 6. TLS

The state cookie and the refresh cookie are `Secure` in production, so the redirect URI is an HTTPS address there. A local run against the provider stand-in uses plain HTTP and turns `AUTH_COOKIE_SECURE` off, as the cookie skill's environment step describes.
