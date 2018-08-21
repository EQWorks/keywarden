const express = require('express')

const {
  loginUser,
  signJWT,
  verifyOTP,
  verifyJWT,
  confirmUser,
} = require('./modules/auth')
const {
  getUser,
  getUsers,
  editUser,
} = require('./modules/manage')

const api = express.Router()

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

// JWT fields check middleware
const hasTokenFields = (...required) => (req, res, next) => {
  const token = req.get('eq-api-jwt')
  let userInfo
  // preliminary jwt verify
  try {
    userInfo = verifyJWT(token)
  } catch(err) {
    console.error(`[ERROR] ${err.message}`, err.stack || err)
    const error = new Error(`Invalid JWT: ${token}`)
    error.statusCode = 403
    err.logLevel = 'WARNING'
    return next(error)
  }
  // payload fields existence check
  if (!required.every(k => k in userInfo)) {
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
  // login user and send OTP email
  return loginUser({
    user,
    redirect: decodeURIComponent(redirect || `${origin}/verify`),
    zone: decodeURIComponent(zone || 'utc'),
  }).then((info) => {
    const message = `Login passcode sent to ${user} through email`
    console.log(`[INFO] ${message}`, info)
    return res.json({ message, user })
  }).catch(next)
})

// GET /verify
api.get('/verify', hasQueryParams('user', 'otp'), (req, res, next) => {
  const { user, reset_uuid } = req.query
  verifyOTP({
    ...req.query,
    reset_uuid: ['1', 'true'].includes(reset_uuid),
  }).then((token) => {
    const message = `User ${user} verified, please store and use the token responsibly`
    console.log(`[INFO] ${message}`)
    return res.json({ message, user, token })
  }).catch(next)
})

// GET /confirm
api.get('/confirm', hasTokenFields(
  'email', 'api_access', 'jwt_uuid'
), (req, res, next) => {
  const { light } = req.query
  const { userInfo } = req
  const { email: user } = userInfo
  // perform "light" confirmation if requested so
  if (['1', 'true'].includes((light || '').toLowerCase())) {
    const message = `Token confirmed for user ${user} (light)`
    console.log(`[INFO] ${message}`)
    return res.json({ message, user })
  }
  // otherwise perform user db integrity confirmation
  confirmUser(userInfo).then(() => {
    const message = `Token confirmed for user ${user}`
    console.log(`[INFO] ${message}`)
    return res.json({ message, user })
  }).catch(next)
})

// GET /refresh
api.get('/refresh', hasTokenFields(
  'email', 'api_access', 'jwt_uuid'
), (req, res, next) => {
  const { userInfo } = req
  const { reset_uuid } = req.query
  confirmUser({
    ...userInfo,
    reset_uuid: ['1', 'true'].includes(reset_uuid),
  }).then(({ uuid }) => {
    const { email, api_access, jwt_uuid } = userInfo
    const token = signJWT({ email, api_access, jwt_uuid: uuid || jwt_uuid })
    const message = `Token refreshed for user ${email}, please store and use the token responsibly`
    console.log(`[INFO] ${message}`)
    return res.json({ message, token, user: email })
  }).catch(next)
})

// GET /users
api.get('/users', hasQueryParams('user'), hasTokenFields(
  'email', 'api_access', 'jwt_uuid'
), (req, res, next) => {
  const { userInfo: payload } = req
  const { product, user: email } = req.query
  confirmUser(payload).then(({ prefix, api_access }) => {
    return getUser({ email, prefix, api_access, product })
  }).then(({ user }) => {
    return res.json({ user })
  }).catch(next)
})

// GET /users/list
api.get('/users/list', hasTokenFields(
  'email', 'api_access', 'jwt_uuid'
), (req, res, next) => {
  const { userInfo: payload } = req
  const { product } = req.query
  confirmUser(payload).then(({ prefix, api_access }) => {
    return getUsers({ prefix, api_access, product })
  }).then(({ users }) => {
    return res.json({ users })
  }).catch(next)
})

// POST /users
api.post('/users', hasTokenFields(
  'email', 'api_access', 'jwt_uuid'
), (req, res, next) => {
  const { userInfo: payload } = req
  const { user, product='atom', update=true } = req.query
  const userInfo = { ...(req.body || {}) }
  userInfo.email = userInfo.email || user
  confirmUser(payload).then(({ prefix, api_access }) => {
    return editUser({
      userInfo,
      prefix,
      api_access,
      product,
      newUser: !user,
    })
  }).then(() => {
    return res.json({
      message: `User ${userInfo.email} ${user ? 'updated' : 'created'}`
    })
  }).catch(next)
})

module.exports = api
