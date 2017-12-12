# keywarden

Central auth service that signs JWT using a given user's current `api_access` on successful passwordless login.

## workflow

### /login

This adapts EQ's existing "passwordless" login process, generates OTP (one time passcode) and send to user through email (as both "magic link" and the plaintext passcode)

### /verify

Modifies from the current "passwordless" login process, upon receiving and validating the OTP obtained from the [`/login`](#login) process, instead of having the requesting application to generate and maintain a "session", `keywarden` signs a stateless [JWT (JSON web token)](https://jwt.io) for the requesting application to use for further API access against `overseer` and alike. `overseer` and other API services would verify the JWT using the same JWT secret that `keywarden` uses to sign the tokens, before further validating access such as a given user's `api_access` and an unique `jwt_uuid` that can be used to manually invalidating all previously signed JWTs of the user.

### Further validation...

Each JWT contains user's `api_access` values and a `jwt_uuid` value that can be used by API services such as `overseer` to compare against what the user has in the EQ users datastore (currently MongoDB), after the basic JWT verification has passed.
