# Credential routes

A request carries its credential in one place, and the context decides which. By default the context reads the `x-renchan-access-token` header. Another route replaces that read by overriding one static method on the context class, and nothing else in the framework changes: `static extractAccessToken()` returns the credential as a string (or `null`), `static findUser()` turns it into an entity (or `null`), and the visa issuers and the filter handler work from there ([engine-and-context](./engine-and-context.md)).

```js
// BaseRestfulApiContext, as shipped
static extractAccessToken ({
  expressRequest,
}) {
  return expressRequest.headers?.[this.ACCESS_TOKEN_HEADER_KEY]
    ?? null
}
```

Two rules hold for every route below.

- **`extractAccessToken()` only reads.** It is synchronous, so it does no I/O and verifies nothing: it returns the raw credential. Verification, key fetches and database lookups belong to `findUser()`, which is async and receives the credential as `accessToken`.
- **A context reads exactly one route, and a missing credential is `null`.** Do not write "try the cookie, then the header". A context that falls through lets a request that lost its intended credential authenticate by a weaker one, and the visa then says `hasAuthenticated` for the wrong reason. A different audience that authenticates differently gets its own engine and its own Context class.

The four readers sit in one app class, so a REST context and a GraphQL context that use the same route call the same code. Each takes the request's `headers`, which both contexts can supply.

```js
import {
  parse,
} from 'cookie'

export default class AccessCredentialReader {
  static readCookie ({
    headers,
    cookieName,
  }) {
    if (!headers?.cookie) {
      return null
    }

    return parse(headers.cookie)[cookieName]
      ?? null
  }

  static readBearerToken ({
    headers,
  }) {
    const matched = (headers?.authorization ?? '')
      .match(/^Bearer\s+(\S+)$/iu)

    return matched?.[1]
      ?? null
  }

  static readIapAssertion ({
    headers,
  }) {
    return headers?.['x-goog-iap-jwt-assertion']
      ?? null
  }

  static readHmacSignature ({
    headers,
  }) {
    return headers?.['x-signature']
      ?? null
  }
}
```

Node lower-cases every header name, so the keys are lower case. The REST context calls a reader from its override:

```js
export default class AppRestfulApiContext extends BaseRestfulApiContext {
  /** @override */
  static extractAccessToken ({
    expressRequest,
  }) {
    return AccessCredentialReader.readBearerToken({
      headers: expressRequest.headers,
    })
  }
}
```

## Cookie

The credential is a cookie of its own, never the refresh-token cookie of `/hor-cookie-authentication`, which only `renewAccessToken` and `signOut` may read. Read it with `readCookie({ headers, cookieName })`. No cookie-parsing middleware is mounted, so the `cookie` package parses the header (`npm install cookie`, which `/hor-cookie-authentication` already does for its own cookie).

A browser attaches a cookie to every request to its origin, so this route gives up the protection a custom header has. Set it `HttpOnly`, `Secure` and `SameSite=Lax` or `Strict`, and add a defence for state-changing requests: a custom header the page must set, or a check of `origin` against the allowed origins. `findUser()` looks the token up as it does for the header.

## Bearer token

The credential is the `authorization` header with the `Bearer` scheme. `readBearerToken()` matches the scheme without regard to case and returns `null` for any other scheme or a missing token. `findUser()` is identical to the header route's: look the token up, return the entity or `null`.

## IAP assertion

The credential is the JWT that IAP puts in `x-goog-iap-jwt-assertion`. `readIapAssertion()` returns it unverified. `findUser()` verifies the signature, issuer, audience and expiry before it trusts a claim, then finds the actor. The verifier, the claims and the lookup are in [behind-iap](./behind-iap.md). The `x-goog-authenticated-user-email` header that IAP also sets is not signed, so no code reads it.

## HMAC signature

The credential is a signature that a caller computes over the request with a secret both sides hold, for a partner system that calls the API with no user. The header carries a timestamp and the digest, and a second header names the key:

```
x-key-id: partner-0001
x-signature: t=1767225600,v1=<hex HMAC-SHA256 of "<t>.<METHOD>.<path>.<raw body>">
```

`readHmacSignature()` returns the `x-signature` value, or `null` when the header is missing. `findUser()` returns `null` for that case before it parses anything, re-reads `x-key-id`, and checks four things in this order: the timestamp lies within a window of `requestedAt` (five minutes), a partner holds that key id, the digest matches, and the partner is active. The signed text binds the method and the path (with its query string), so a signature captured for one operation cannot authorize another.

```js
static async findUser ({
  expressRequest,
  accessToken,
  requestedAt = new Date(),
}) {
  if (accessToken === null) {
    return null
  }

  const signature = SignatureHeader.create({ headerValue: accessToken })

  if (signature.isStale({ pointsAt: requestedAt })) {
    return null
  }

  const partnerEntity = await Partner.findByKeyId({
    keyId: expressRequest.headers['x-key-id'],
  })

  if (partnerEntity === null) {
    return null
  }

  const hasMismatchedSignature = partnerEntity.hasMismatchedSignature({
    signature,
    method: expressRequest.method,
    path: expressRequest.originalUrl,
    rawBody: expressRequest.rawBody,
  })

  if (hasMismatchedSignature) {
    return null
  }

  if (partnerEntity.isDeactivated()) {
    return null
  }

  return partnerEntity
}
```

`SignatureHeader` splits `t=<seconds>,v1=<hex>` into `timestamp` and `digestHex`, and `isStale()` is true when the timestamp lies outside the window around a moment.

```js
// Partner
hasMismatchedSignature ({
  signature,
  method,
  path,
  rawBody,
}) {
  const expected = createHmac('sha256', this.extractSigningSecret())
    .update(`${signature.timestamp}.${method.toUpperCase()}.${path}.`)
    .update(rawBody ?? '')
    .digest()
  const received = Buffer.from(signature.digestHex, 'hex')

  return received.length !== expected.length
    || !timingSafeEqual(received, expected)
}
```

- **Compare in constant time, and compare lengths first.** `timingSafeEqual` throws on buffers of different length, and a `===` on hex strings leaks where they first differ.
- **The window blocks replay of an old request.** Inside the window a replay still verifies, so a state-changing operation that must run once carries an idempotency key of its own.
- **The signing secret must be recoverable**, because the server recomputes the digest. Store it encrypted, never hashed, and read it through the Share's env-held key, as every env value is read.
- **The signature covers the raw bytes.** The engine's body parser has to keep them: the `verify` callback of `express.json` stores `req.rawBody` as the `Buffer` it is given, under `// eslint-disable-next-line no-param-reassign`, the directive the lint config allows in the engine files. A GraphQL engine captures `rawBody` on `urlencoded` only, so its `express.json` needs the same `verify`. A body re-serialized from the parsed object is not the bytes the caller signed.
