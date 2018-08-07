const serverless = require('serverless-http')
const express = require('express')
const cors = require('cors')

const {
  getOtp,
  loginUser,
  sendOtp,
  signJwt,
  verifyOtp,
  verifyJwt,
  confirmUser,
  checkRequired,
} = require('./modules/auth.js')

// express app
const app = express()
// trust proxy to get API Gateway/Cloud Front forwarded headers
app.enable('trust proxy')
// enable CORS for endpoints and their pre-flight requests (when applicable)
app.use(cors())
app.options('*', cors())

// middleware
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

const verifyToken = (req, res, next) => {
  const token = req.get('eq-api-jwt')
  const { light } = req.query
  let userInfo
  // preliminary jwt verify
  try {
    userInfo = verifyJwt(token)
  } catch(err) {
    console.error(`[ERROR] ${err.message}`, err.stack || err)
    const error = new Error(`Invalid JWT: ${token}`)
    error.statusCode = 403
    err.logLevel = 'WARNING'
    return next(error)
  }
  // payload fields existence check
  if (!checkRequired({ userInfo })) {
    const error = new Error('JWT missing required fields in payload')
    error.statusCode = 403
    error.logLevel = 'WARNING'
    return next(error)
  }
  req.userInfo = userInfo
  return next()
}

// GET /
app.get('/', (req, res, next) => {
  let { KEYWARDEN_VER, STAGE } = process.env
  return res.json({
    STAGE,
    KEYWARDEN_VER,
  })
})

// GET /login
app.get('/login', hasQueryParams('user'), (req, res, next) => {
  const { user, redirect, zone } = req.query
  let { stage } = req.context || {}
  stage = stage || process.env.STAGE
  let origin = `${req.protocol}://${req.get('host')}`
  if (stage) {
    origin += `/${stage}`
  }
  const otp = getOtp() // grab an otp
  // get user and set its otp
  return loginUser({
    user,
    otp,
    zone: decodeURIComponent(zone || 'utc'),
  }).then((userInfo) => {
    // send OTP along with redirect (magic) link for /verify
    return sendOtp({
      userInfo,
      redirect: decodeURIComponent(redirect || `${origin}/verify`)
    })
  }).then((info) => {
    const message = `Login passcode sent to ${user} through email`
    console.log(`[INFO] ${message}`, info)
    return res.json({ message, user })
  }).catch(next)
})

// GET /verify
app.get('/verify', hasQueryParams('user', 'otp'), (req, res, next) => {
  verifyOtp(req.query).then((r) => {
    const { user, token } = r
    const message = `User ${user} verified, please store and use the token responsibly`
    console.log(`[INFO] ${message}`)
    return res.json({ message, user, token })
  }).catch(next)
})

// GET /confirm
app.get('/confirm', verifyToken, (req, res, next) => {
  const { light } = req.query
  const { userInfo } = req
  const { email: user } = userInfo
  if (['1', 'true'].includes((light || '').toLowerCase())) {
    const message = `Token confirmed for user ${user} (light)`
    console.log(`[INFO] ${message}`)
    return res.json({ message, user })
  }
  confirmUser(userInfo).then((r) => {
    if (!r) {
      const error = new Error(`Token payload no longer valid for user ${user}`)
      error.statusCode = 403
      error.logLevel = 'WARNING'
      return next(error)
    }
    const message = `Token confirmed for user ${user}`
    console.log(`[INFO] ${message}`)
    return res.json({ message, user })
  })
})

// GET /refresh
app.get('/refresh', verifyToken, (req, res, next) => {
  const { userInfo } = req
  const { email: user } = userInfo
  confirmUser(userInfo).then((r) => {
    if (!r) {
      const error = new Error(`Token payload no longer valid for user ${user}`)
      error.statusCode = 403
      error.logLevel = 'WARNING'
      return next(error)
    }
    const { email, api_access, jwt_uuid } = userInfo
    const token = signJwt({ email, api_access, jwt_uuid })
    const message = `Token refreshed for user ${user}, please store and use the token responsibly`
    console.log(`[INFO] ${message}`)
    return res.json({ message, token, user })
  })
})

// catch-all error handler
app.use((err, req, res, next) => {
  let { logLevel, statusCode } = err
  const { message } = err
  logLevel = logLevel || 'ERROR'
  statusCode = statusCode || 500
  // app log
  console.log(`[${logLevel}] - ${statusCode} - ${message}`)
  if (logLevel === 'ERROR') {
    console.error(`[ERROR] ${message}`, err.stack || err)
  }
  // API response
  return res.status(statusCode).json({
    statusCode,
    logLevel,
    message,
  })
})

if (require.main === module) {
  app.listen(3333, () => {
    console.log('Listening on port 3333')
  })
} else {
  module.exports.handler = serverless(app, {
    request: (request, event) => {
      request.context = event.requestContext || {}
    },
  })
}
