# keywarden

Central auth service.

## Workflow

### Login

`GET /login?user=<REQUIRED: email>&redirect=[OPTIONAL: redirect URL]`

This adapts EQ's existing "passwordless" login process, generates OTP (one-time passcode) and send to user through email (as both "magic link" and the plaintext passcode).

![OTP](https://vignette.wikia.nocookie.net/yugioh/images/9/92/OneTimePasscode-CIBR-EN-R-1E.png/revision/latest/scale-to-width-down/300?cb=20171020172733)

Optional `redirect` querystring parameter can be used for easy client side login workflow integration. The supplied URL will be kept exactly as submitted, except its `user` and `otp` querystring parameters will be enforced. For example, if the supplied `redirect` URL is:

```https://overlord.eqworks.io/login?a=1&b=2&user=leo.li@eqworks.com```

it'll become

```https://overlord.eqworks.io/login?a=1&b=2&user=leo.li@eqworks.com&otp=<OTP generated>```

when it's sent as the "magic link" through email.

Upon receiving this, the requesting client should make `GET /verify` request on user's behalf with the given `user` and `otp`.

### Verify OTP

`GET /verify?user=<REQUIRED: email>&otp=<REQUIRED: one-time passcode>&reset_uuid=[OPTIONAL: 1 or true]`

Upon receiving and validating the OTP obtained from the `/login` process, instead of having the requesting application to generate and maintain a "session", `keywarden` signs a stateless [JWT (JSON web token)](https://jwt.io) for the requesting application to use for further API access against `overseer` and alike.

If `reset_uuid` is supplied as a value of `1` or `true`, given `user`'s `jwt_uuid` will be reset to a new value. This can be used to effectively invalidate all past tokens of given `user`.

### Confirm JWT 

`GET /confirm?light=[OPTIONAL: 1 or true]`

JWT supplied as `Header 'eq-api-jwt'`

This endpoint performs the following confirmation/validation:
1. A preliminary `jwt.verify` against the secret that signed the token.
2. If `light` is not supplied or not a value of `1` or `true`, a further integrity check against the user database will be performed.

### Refresh JWT

`GET /refresh`

JWT supplied as `Header 'eq-api-jwt'`

This is designed to be a simple and not so rigorous mechanism to refresh a given JWT with a new JWT (new expiration). Mostly targeted for use cases to extend expiration. See https://stackoverflow.com/a/26834685/158111 as a vague guideline on the application implementation side on when and how to utilize the refresh mechanism.

Behavior-wise it's almost identical to the `/confirm` endpoint except that on (confirmation) success, a new token is signed and responded, instead of a mere confirmation.
