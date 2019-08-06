const { verifyJWT, confirmUser } = require('../modules/auth')

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
    console.error(`[ERROR] ${err.message}`, err.stack || err)
    const error = new Error(`Invalid JWT: ${token}`)
    error.statusCode = 403
    err.logLevel = 'WARNING'
    return next(error)
  }
  // payload fields existence check
  if (!fields.every(k => k in user)) {
    const error = new Error('JWT missing required fields in payload')
    error.statusCode = 403
    error.logLevel = 'WARNING'
    return next(error)
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
      const error = new Error(`Missing '${param}' in query string parameters`)
      error.statusCode = 400
      error.logLevel = 'WARNING'
      return next(error)
    }
  }
  return next()
}

module.exports = {
  confirmed,
  hasQueryParams,
}
