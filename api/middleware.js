const { verifyJWT, confirmUser } = require('../modules/auth')
const { sentry, AuthorizationError, APIError } = require('../modules/errors')

// JWT confirmation middleware
const confirmed = ({ allowLight = false } = {}) => (req, res, next) => {
  const { light, reset_uuid, product = 'atom' } = req.query
  const fields = ['email', 'api_access', 'jwt_uuid']
  const token = req.get('eq-api-jwt')
  let user
  // preliminary jwt verify
  try {
    user = verifyJWT(token)
  } catch (err) {
    // log raw error from JWT to Sentry
    sentry().logError(err)
    console.error(`[ERROR] ${err.message}`, err.stack || err)
    return next(new AuthorizationError(`Invalid JWT: ${token}`))
  }
  // payload fields existence check
  if (!fields.every(k => k in user)) {
    return next(new AuthorizationError('JWT missing required fields in payload'))
  }
  // DB integrity check
  if (allowLight && ['1', 'true'].includes(light)) {
    req.userInfo = { ...user, light: true }
    return next()
  }
  confirmUser({
    ...user,
    reset_uuid: ['1', 'true'].includes(reset_uuid),
    product,
  })
    .then(userInfo => {
      req.userInfo = { ...userInfo, light: false }
      return next()
    })
    .catch(next)
}

// query parameter check middleware
const hasQueryParams = (...params) => (req, res, next) => {
  for (const param of params) {
    if (!req.query[param]) {
      return next(new APIError({ message: `Missing '${param}' in query string parameters`, statusCode: 400, logLevel: 'WARNING' }))
    }
  }
  return next()
}

module.exports = {
  confirmed,
  hasQueryParams,
}
