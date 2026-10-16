# ID token verification

The ID token is a signed JWT, and the app must verify it before reading one claim from it. `OidcIdTokenVerifier` (`app/oidc/`) does this with `jose`: `createRemoteJWKSet` fetches and caches the provider's public keys, and `jwtVerify` checks the signature and the claims in one call.

```js
import {
  createRemoteJWKSet,
  jwtVerify,
} from 'jose'

export default class OidcIdTokenVerifier {
  constructor ({
    clientId,
    issuer,
    jwks,
  }) {
    this.clientId = clientId
    this.issuer = issuer
    this.jwks = jwks
  }

  static create ({
    clientId,
    providerConfiguration,
  }) {
    return new this({
      clientId,
      issuer: providerConfiguration.issuer,
      jwks: createRemoteJWKSet(new URL(providerConfiguration.jwksUri)),
    })
  }

  /**
   * Verify the ID token and return its claims.
   *
   * @param {{
   *   idToken: string
   *   nonce: string
   * }} params
   * @returns {Promise<import('jose').JWTPayload>}
   */
  async verify ({
    idToken,
    nonce,
  }) {
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: this.issuer,
      audience: this.clientId,
      algorithms: ['RS256'],
      clockTolerance: 30,
    })

    if (payload.nonce !== nonce) {
      throw new Error('The nonce claim differs from the stored nonce')
    }

    if (this.hasUnrelatedAuthorizedParty({ payload })) {
      throw new Error('The azp claim names another client')
    }

    return payload
  }

  hasUnrelatedAuthorizedParty ({
    payload,
  }) {
    const hasSeveralAudiences = Array.isArray(payload.aud)
      && payload.aud.length > 1

    return hasSeveralAudiences
      && payload.azp !== this.clientId
  }
}
```

## What each check rules out

| Check | Rules out |
| --- | --- |
| Signature, with the key picked by the header's `kid` | A token the provider never signed |
| `algorithms` pinned to the one the provider uses | A token that names `none`, or a symmetric algorithm keyed with a public key |
| `iss` equals the configured issuer, as a string | A token from another provider, or another tenant of the same one |
| `aud` contains `OIDC_CLIENT_ID` | A token issued to a different application |
| `azp` equals the client id, when `aud` holds several values | A token another client of the provider could replay here |
| `exp` in the future, with a small tolerance | An old token |
| `nonce` equals the stored nonce | A token minted for another authorization, which replays an earlier one |

`jwtVerify` enforces the signature, `algorithms`, `iss`, `aud` and `exp`. The `azp` and `nonce` lines are the app's own, so `verify()` compares them whatever the library version does.

- **Pin `algorithms` to what the provider lists as `id_token_signing_alg_values_supported`.** `RS256` is the default the specification sets for ID tokens, so it is the default here. A provider that signs with `ES256` or `PS256` takes that value instead, never a list that widens past the provider's own.
- **Unknown `kid`.** `createRemoteJWKSet` refetches the key set when a token names a key it does not hold, and not more often than its cooldown allows. The provider rotates keys on its own schedule, and the app does nothing about it.
- **Every failure is one error to the client.** `jwtVerify` throws a distinct error for an expired token, a failed signature and a wrong claim. The resolver catches all of them, logs the class name, and raises one `OidcIdTokenInvalid`, so the response teaches an attacker nothing.

## Why the Share keeps the verifier

`/hor-graphql-server-engine` says the Share keeps no instance that needs only `env`, and the verifier looks like one. It stays in the Share because it holds state that has to outlive a request: the key cache. A verifier created per request fetches the key set from the provider on every sign-in, which is slow and can trip the provider's rate limit. The configuration object is kept for the same reason, since it is a fetched document.
