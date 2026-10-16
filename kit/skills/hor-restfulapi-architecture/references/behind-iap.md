# An application behind IAP

Identity-Aware Proxy (IAP) sits in front of the application and signs the user in before a request reaches it. The application then has **no sign-in of its own**: no password, no `signIn`, no `signUp`, no refresh token, no cookie, and no session table. Each request arrives with a JWT that IAP signed, and the context verifies it and finds the actor it names. Everything `/hor-cookie-authentication` and `/hor-oidc-sign-in` build is absent, and the access-token header is unused.

## What IAP puts on the request

| Header | Use |
| --- | --- |
| `x-goog-iap-jwt-assertion` | The signed JWT. The only header the application trusts. |
| `x-goog-authenticated-user-email`, `x-goog-authenticated-user-id` | Plain headers anyone who reaches the application can set. The application never reads them. |

The JWT is signed with ES256 and carries the key id in its header. Its claims the application reads:

| Claim | Value | Check |
| --- | --- | --- |
| `iss` | `https://cloud.google.com/iap` | Equals this string exactly |
| `aud` | `/projects/<project-number>/global/backendServices/<backend-service-id>` for a backend service, or `/projects/<project-number>/apps/<project-id>` for App Engine | Equals the configured audience exactly |
| `exp` | Ten minutes after `iat` | In the future |
| `sub` | The stable account identifier, prefixed `accounts.google.com:` | Used as the lookup key |
| `email` | The signed-in address | Matched once, on first sight |

Copy the audience string from the protected resource's IAP settings, not from a composition of its parts: a digit transposed in the project number rejects every request, and the verification error does not say why.

## The verifier

`IapAssertionVerifier` mirrors the OIDC verifier (`npm install jose`): `jose` fetches and caches Google's public keys for IAP (published as a JWK set), and `jwtVerify` checks the signature and the claims. It checks `exp` only when the token carries one, so `requiredClaims` rejects an assertion that lacks `exp`, `iat`, `sub` or `email`. The Share keeps it, because the key cache has to outlive a request, and creates it from two env values, `IAP_AUDIENCE` and `IAP_JWKS_URL`.

```js
import {
  createRemoteJWKSet,
  jwtVerify,
} from 'jose'

const IAP_ISSUER = 'https://cloud.google.com/iap'

export default class IapAssertionVerifier {
  constructor ({
    audience,
    jwks,
  }) {
    this.audience = audience
    this.jwks = jwks
  }

  static create ({
    audience,
    jwksUrl,
  }) {
    return new this({
      audience,
      jwks: createRemoteJWKSet(new URL(jwksUrl)),
    })
  }

  async verify ({
    assertion,
  }) {
    const { payload } = await jwtVerify(assertion, this.jwks, {
      issuer: IAP_ISSUER,
      audience: this.audience,
      algorithms: ['ES256'],
      requiredClaims: ['exp', 'iat', 'sub', 'email'],
    })

    return payload
  }
}
```

Fix the issuer and the algorithm in code. Only the key location and the audience vary by environment, and the local stand-in signs with the real issuer (`/hor-build-e2e-test-environment`), so no check is relaxed to make a local run pass.

## The context

`extractAccessToken()` returns the header ([credential-routes](./credential-routes.md)), and `findUser()` verifies it. A request with no assertion, or one that fails verification, resolves no user, and the filter answers `Unauthenticated`.

```js
export default class AppRestfulApiContext extends BaseRestfulApiContext {
  /** @override */
  static extractAccessToken ({
    expressRequest,
  }) {
    return AccessCredentialReader.readIapAssertion({
      headers: expressRequest.headers,
    })
  }

  /** @override */
  static async findUser ({
    engine,
    accessToken,
  }) {
    if (accessToken === null) {
      return null
    }

    const claimHash = await engine.share.iapAssertionVerifier
      .verify({ assertion: accessToken })
      .catch(() => null)

    if (claimHash === null) {
      return null
    }

    return Operator.findOrLinkByIapClaims({ claimHash })
  }
}
```

- **Verify on every request, and never fall through.** The application is reachable by something other than IAP (a neighbour in the network, a misconfigured firewall rule), and an unverified header there is a forged identity. A missing header is `Unauthenticated`, not a reason to try another route.
- **`findOrLinkByIapClaims()` finds the actor by `sub`.** On a miss it looks for a pre-registered actor with that `email` and records the `sub` against it in one guarded update, so every later request finds it by `sub`. A person IAP admits but the application does not know gets `null`. Create the actor on first sight only when the specification says anyone IAP admits may use the application.
- **The filter has almost nothing to skip.** `schemasToSkipFiltering` holds a health check at most, because there is no sign-in operation to be public. Authorization (`hasAuthorized`, `hasSchemaPermission`) still comes from the visa, from what the actor entity says it may do.
- **Sign-out is IAP's.** The application holds no session to revoke, so it ships no `signOut`. Ending the session means ending the Google session, which the frontend reaches through IAP's own sign-out path.
