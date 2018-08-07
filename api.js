const express = require('express')

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

const api = express.Router()

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
api.get('/', (req, res) => {
  let { KEYWARDEN_VER, STAGE } = process.env
  return res.json({
    STAGE,
    KEYWARDEN_VER,
  })
})

// GET /login
api.get('/login', hasQueryParams('user'), (req, res, next) => {
  const { user, redirect, zone } = req.query
  const { STAGE } = process.env
  let origin = `${req.protocol}://${req.get('host')}`
  if (STAGE) {
    origin += `/${STAGE}`
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
api.get('/verify', hasQueryParams('user', 'otp'), (req, res, next) => {
  verifyOtp(req.query).then((r) => {
    const { user, token } = r
    const message = `User ${user} verified, please store and use the token responsibly`
    console.log(`[INFO] ${message}`)
    return res.json({ message, user, token })
  }).catch(next)
})

// GET /confirm
api.get('/confirm', verifyToken, (req, res, next) => {
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
api.get('/refresh', verifyToken, (req, res, next) => {
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

module.exports = api
