const { verifyJWT, confirmUser } = require('../modules/auth')
const { sentry, AuthorizationError, APIError } = require('../modules/errors')

// JWT confirmation middleware
const confirmed = ({ allowLight = false, defaultTargetProduct = 'atom' } = {}) => (req, res, next) => {
  const { light, reset_uuid, product: targetProduct = defaultTargetProduct } = req.query
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

  // set product to atom if missing from jwt or falsy for backward compatibility
  user.product = user.product || 'atom'

  // payload fields existence check
  if (!fields.every(k => k in user)) {
    return next(new AuthorizationError('JWT missing required fields in payload'))
  }

  // product check
  if (targetProduct !== 'all' && user.product.toLowerCase() !== targetProduct.toLowerCase()) {
    return next(new AuthorizationError('JWT not valid for this resource'))
  }

  // DB integrity check
  if (allowLight && ['1', 'true'].includes(light)) {
    req.userInfo = { ...user, light: true }
    return next()
  }
  confirmUser({
    ...user,
    reset_uuid: ['1', 'true'].includes(reset_uuid),
    // check accesses relative to product embedded in jwt when query param 'product' === 'all'
    product: (targetProduct === 'all' ? user.product : targetProduct),
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
