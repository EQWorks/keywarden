const { verifyJWT, getUserAccess } = require('../modules/auth')
const { PRODUCT_ATOM } = require('../constants')
const { AuthorizationError, APIError, InternalServerError, LOG_LEVEL_ERROR } = require('../modules/errors')
const moment = require('moment-timezone')


// JWT confirmation middleware
// forceLight takes precedence over allowLight when the former resolves to true
/**
 * Factory function for access verification middleware
 * Light check only confirms integrity of JWT while full check confirms that
 * JWT access payload aligns with the user's CURRENT permissions
 * @param {Object} options
 * @param {boolean|(access: object) => boolean} [options.forceLight=false] Boolean flag or callback function to indicate whether
 * //to force a light check or not
 * @param {boolean|(access: object) => boolean} [options.allowLight=false] Boolean flag or callback function to indicate whether
 * // to allow a  check or not. When resolving to true, the caller may request a light check by supplying req.light === '1'|'true'
 * @returns {function} Middleware function
 */
const confirmed = ({ forceLight = false, allowLight = false } = {}) => async (req, _, next) => {
  try {
    const { light, reset_uuid, product: targetProduct = PRODUCT_ATOM } = req.query
    const token = req.get('eq-api-jwt')

    let user
    // preliminary jwt verify
    try {
      user = verifyJWT(token)
    } catch (err) {
      // wrap error and up log level so it is logged to Sentry
      throw new AuthorizationError.fromError(err, { message: `Invalid JWT: ${token}`, logLevel: LOG_LEVEL_ERROR })
    }

    // determine JWT TTL
    const ttl = 'exp' in user ? 1000 * user.exp - Date.now() : -1
    req.ttl = {
      millis: ttl,
      friendly: moment.duration(ttl).humanize(),
    }

    user = await getUserAccess({ user, light, reset_uuid, targetProduct, forceLight, allowLight })

    req.userInfo = user
    return next()
  } catch (err) {
    if (err instanceof APIError) {
      return next(err)
    }
    next(InternalServerError.fromError(err, 'Failed to validate the existing token'))
  }
}

// query parameter check middleware
const hasQueryParams = (...params) => (req, res, next) => {
  for (const param of params) {
    if (!req.query[param]) {
      return next(new APIError({ message: `Missing '${param}' in query string parameters`, statusCode: 400 }))
    }
  }
  return next()
}

module.exports = {
  confirmed,
  hasQueryParams,
}
