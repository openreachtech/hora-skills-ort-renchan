# Environment & config

Set these up once per project, before (or alongside) building the auth cluster. Steps:

## 1. Dependency

The cookie clerk ([cookie-context](./cookie-context.md)) parses and writes cookies with the `cookie` package. Add it:

```
npm install cookie
```

## 2. Auth env vars

Cookie attributes and the refresh-token lifetime are environment-driven, so they change per deploy with no code change. Add to each `.env.*` (left empty in the boilerplate; each app fills them):

```
AUTH_REFRESH_TOKEN_TTL_DAYS=
AUTH_COOKIE_SECURE=
AUTH_COOKIE_SAME_SITE=
AUTH_COOKIE_PATH=
AUTH_COOKIE_DOMAIN=
```

Declare them on the env-facade typedef (`app/globals/env.js` + `env.cjs`) and read them **through the facade** (`env.AUTH_*`), never `process.env` directly. The refresh-token model reads the TTL from it, with a fallback default:

```js
static get ttlDays () {
  return Number(env.AUTH_REFRESH_TOKEN_TTL_DAYS)
    || DEFAULT_REFRESH_TOKEN_TTL_DAYS // 14
}
```

The access-token lifetime is **not** env-driven — it is a fixed short module constant (15 minutes) in the access-token model ([token-models](./token-models.md)).

## 3. Cookie-name constant, per actor

Each actor's refresh cookie has its own name so audiences never collide. Define it as a constant ([[hor-constant-definition]]) — a CommonJS master under `constants/` plus its ESM bridge:

```js
// constants/authConstants.cjs
REFRESH_TOKEN_COOKIE: {
  <ACTOR>: {
    NAME: '<actor>_refresh_token',
  },
}
```

## 4. Engine cookie config

The engine assembles the cookie config the context and clerk read — env-driven attributes plus the per-actor name ([cookie-context](./cookie-context.md), [auth-filter](./auth-filter.md)):

```js
static buildRefreshTokenCookieConfig () {
  return {
    ...this.refreshTokenCookieConfig, // secure / sameSite / httpOnly / lifetimeDays, from env
    name: REFRESH_TOKEN_COOKIE.<ACTOR>.NAME,
  }
}
```

## 5. TLS

`AUTH_COOKIE_SECURE=true` requires HTTPS — over plain HTTP the browser drops a `Secure` cookie, so dev usually runs it off. It pairs with serving the frontend same-origin ([[hof-cookie-authentication]]).
