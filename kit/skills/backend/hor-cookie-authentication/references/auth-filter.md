# Auth-filter policy

The engine decides which operations are public and how the rest authenticate. Set this on the audience's `*GraphqlServerEngine` ([[hor-graphql-server-engine]]).

## Public operations

The auth operations skip the header filter. `renewAccessToken` runs when the access token is already expired, so it cannot require the header; `signIn` / `signUp` authenticate by credentials; `signOut` and `renewAccessToken` authenticate by the refresh **cookie** inside the resolver ([cookie-context](./cookie-context.md)).

```js
get schemasToSkipFiltering () {
  return [
    'signUp',
    'signIn',
    'renewAccessToken',
    'signOut',

    'healthCheck', // fully public
  ]
}
```

## Everything else — the access-token header

Every operation not on that list goes through the filter, which authenticates by the `x-renchan-access-token` header. The context resolves the actor from the header token; the filter then checks the visas:

```js
generateFilterHandler () {
  return async ({ information, context }) => {
    const schema = information.fieldName

    if (context.canResolve({ schema })) {
      return // a skip-list operation
    }

    if (!context.hasAuthenticated()) {
      throw this.errorHash.Unauthenticated.create()
    }

    if (!context.hasAuthorized()) {
      throw this.errorHash.Unauthorized.create()
    }

    // ... schema-permission check ...
  }
}
```

## Resolving the actor from the header

The context turns the header access token into the actor entity, and the visa issuers read that:

- `Context.findUser({ accessToken, ... })` — look the access token up and return the actor entity (or `null`).
- `visaIssuers.hasAuthenticated` — `userEntity !== null`.

So the access token is only ever a header credential; the refresh token is only ever a cookie credential, and only for the two skip-listed operations.
