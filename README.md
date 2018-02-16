# keywarden

Central auth service that signs JWT using a given user's current `api_access` on successful passwordless login.

## workflow

### `GET /login?user=<REQUIRED: email>&redirect=[OPTIONAL: redirect URL]`

This adapts EQ's existing "passwordless" login process, generates OTP (one-time passcode) and send to user through email (as both "magic link" and the plaintext passcode).

Optional `redirect` querystring parameter can be used for easy client side login workflow integration. The supplied URL will be kept exactly as submitted, except its `user` and `otp` querystring parameters will be enforced. For example, if the supplied `redirect` URL is:

```https://overlord.eqworks.io/login?a=1&b=2&user=leo.li@eqworks.com```

it'll become

```https://overlord.eqworks.io/login?a=1&b=2&user=leo.li@eqworks.com&otp=<OTP generated>```

when it's sent as the "magic link" through email.

Upon receiving this, the requesting client should make `GET /verify` request on user's behalf with the given `user` and `otp`.

### `GET /verify?user=<REQUIRED: email>&otp=<REQUIRED: one-time passcode>`

Modifies from the current "passwordless" login process, upon receiving and validating the OTP obtained from the `/login` process, instead of having the requesting application to generate and maintain a "session", `keywarden` signs a stateless [JWT (JSON web token)](https://jwt.io) for the requesting application to use for further API access against `overseer` and alike.

### `GET /confirm?light=[optional: 1 or true]`

JWT supplied as `Header 'eq-api-jwt'`

This endpoint performs the following confirmation/validation:

- A preliminary `jwt.verify()` against the same JWT Secret that was used for signing tokens
- A payload field existence check against the theoretical required fields
- If the optional `light` querystring parameter is not supplied, or not the truthy indicator (`1` or `true`), a further integrity check will be performed against user database. This is the default behavior
