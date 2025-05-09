/**
 * User auth workflow
 */
const url = require('url')

const uuidv4 = require('uuid/v4')
const jwt = require('jsonwebtoken')
const moment = require('moment-timezone')
const isEqual = require('lodash.isequal')

const { sendMail, magicLinkHTML, otpText } = require('./email.js')
const { updateUser, selectUser, getUserWL } = require('./db')
const { claimOTP, redeemOTP } = require('./auth-otp')
const { AuthorizationError, APIError, LOG_LEVEL_ERROR } = require('./errors')
const { PREFIX_APP_REVIEWER, PREFIX_DEV, PREFIX_MOBILE_SDK, PRODUCT_ATOM, PRODUCT_LOCUS, PRODUCT_CLEARLAKE } = require('../constants.js')
const { capitalizeFirstLetter } = require('./utils')


const {
  OTP_TTL = 5 * 60 * 1000, // in milliseconds
  JWT_SECRET,
  JWT_TTL = 90 * 24 * 60 * 60, // in seconds
  APP_REVIEWER_OTP = '*'.charCodeAt(0).toString(2),
} = process.env

const isPrivilegedUser = (email, prefix, api_access) => {
  // returns true if this user is high-privilege
  // A user is high privilege if
  // - they have an eqworks email, a 'dev' prefix,
  //   and -1 access to all api_access fields;
  // - or a 'mobilesdk' prefix
  switch(prefix) {
  case PREFIX_DEV:
    return Object.entries(api_access).every(([k, v]) => {
      if (k === 'version') {
        return true
      }
      return v === -1
    }) && email.endsWith('@eqworks.com')
  case PREFIX_MOBILE_SDK:
    return true
  default:
    return false
  }
}

const getUserInfo = async ({ email, product = PRODUCT_ATOM }) => {
  // returns user info
  const selects = ['prefix', 'jwt_uuid', 'client', 'access', 'info', PRODUCT_ATOM, PRODUCT_LOCUS, 'access_expired_at']
  const conditions = ["active = B'1'"]
  const user = await selectUser({ email, selects, conditions })

  if (!user) {
    throw new APIError({
      message: `User ${email} not found`,
      statusCode: 404,
    })
  }
  const now = new Date()
  if (user.access_expired_at && new Date(user.access_expired_at) < now) {
    await updateUser({ 
      email,
      prefix: 'customers',
      jwt_uuid: null,
      client: null,
      atom: { read: 10, write: 0 },
      active: 0,
      access: null,
      access_expired_at: null,
    })
    throw new AuthorizationError(`Access for ${email} has expired. Please contact the administrator to reactivate this account.`)
  }

  // product access (read/write) falls back to 'atom' access if empty object
  const productAccess = Object.keys(user[product] || {}).length ? user[product] : user[PRODUCT_ATOM]
  // TODO: progressive transition to new `access` system (see comments on vX per relevant line)
  return {
    // `prefix` could still be used for special cases: internal+ (-1/-1 client) and mobile-sdk tokens
    prefix: user.prefix,
    jwt_uuid: user.jwt_uuid,
    email,
    product, // v0; deprecated in v1+
    api_access: {
      info: user.info,
      ...user.client, // v0, v1; to be deprecated in v2+
      ...productAccess, // v0; to be deprecated in v1+
      version: 0, // denotes legacy pre-`access` format
      ...user.access, // v1+ policies based `access`, would contain `version` to override ^
      // v1 would contain `policies` fields, which may look like:
      // policies: [
      //   'ql:read',
      //   'ql:write',
      //   'user:read',
      //   'finance:read',
      // ],
      // where each policy is dictated and validated by the product API services
      // v2 could override per-WL policies (e.g.: { wl { cu: -1|[...], policies: [...] } } })
      // v3 could override per-CU policies (e.g.: { wl: { cu: { policies: [...] } } })
    },
    access_expired_at: user.access_expired_at,
  }
}

// Trade OTP for user access
const redeemAccess = async ({ email, otp, reset_uuid = false, product = PRODUCT_ATOM }) => {
  let { prefix, api_access = {}, jwt_uuid, access_expired_at } = await getUserInfo({ email, product })

  if (prefix === PREFIX_APP_REVIEWER) {
    if (otp !== APP_REVIEWER_OTP) {
      throw new AuthorizationError(`Invalid passcode for ${email}`)
    }
  } else {
    await redeemOTP({ otp, email, secret: JWT_SECRET, length: 6 })
  }

  // set `jwt_uuid` if not set already
  if (reset_uuid || !jwt_uuid) {
    jwt_uuid = uuidv4()
    await updateUser({ email, jwt_uuid })
  }

  return { api_access, jwt_uuid, prefix, access_expired_at }
}

const _resetUUID = async ({ email }) => {
  const jwt_uuid = uuidv4()
  await updateUser({ email, jwt_uuid })
  return jwt_uuid
}

// update user OTP and send it along with TTL through email
const loginUser = async ({ user, redirect, zone='utc', product = PRODUCT_ATOM, nolink }) => {
  // get user WL info
  const { rows = [] } = await getUserWL(user)

  const DEFAULT_EMAIL = 'dev@eqworks.com'
  const productSender = product === PRODUCT_CLEARLAKE 
    ? (process.env.CLEARLAKE_SENDER || DEFAULT_EMAIL)
    : DEFAULT_EMAIL
  const supportEmail = product === PRODUCT_CLEARLAKE
    ? (process.env.CLEARLAKE_SUPPORT_EMAIL || DEFAULT_EMAIL)
    : DEFAULT_EMAIL
  
  // TODO: add logo in when email template has logo
  let { sender, company } = rows[0] || {}
  sender = sender || productSender
  company = company || 'EQ Works'
  const { prefix: userPrefix, api_access } = await getUserInfo({ email: user })
  // Check if user has access to the requested product
  if (api_access.version === 2 && userPrefix !== PREFIX_DEV) {
    if (!api_access.policies.some(policy => policy.split(':')[0] === product)) {
      throw new AuthorizationError(`User ${user} does not have access to ${product}`)
    }
  }

  // set otp and ttl (in ms)
  let otp, ttl
  if (userPrefix === PREFIX_APP_REVIEWER) {
    otp = APP_REVIEWER_OTP
    ttl = Date.now() + OTP_TTL
  } else {
    const otpObj = await claimOTP({ email: user, secret: JWT_SECRET, length: 6, minTTL: OTP_TTL, resetTTL: OTP_TTL * 2 })
    otp = otpObj.otp
    ttl = otpObj.ttl
  }

  // localize TTL
  ttl = moment.tz(ttl, zone).format('LLLL z')

  // parse given redirect
  let link = url.parse(redirect, true)
  // inject query string params
  link.query = link.query || {}
  Object.assign(link.query, { user, otp, product })
  // hack to enable link.query over ?search
  link.search = undefined
  // reconstruct into the effective magic link
  link = url.format(link)

  // populate email
  const message = nolink ? {
    text: otpText({ otp, ttl, company, product }),
  } : {
    text: otpText({ link, otp, ttl, company, product }),
    html: magicLinkHTML({ link, otp, ttl, company, product, supportEmail }),
  }
  return sendMail({
    from: sender,
    to: user,
    subject: `${capitalizeFirstLetter(product)} (${company}) Login`,
    ...message,
  })
}

const computeExpiry = (timeout, isPrivilegedUser, access_expired_at) => {
  const now = Date.now()
  if (access_expired_at) {
    const expiryTime = new Date(access_expired_at).getTime()
    const timeRemaining = Math.floor((expiryTime - now) / 1000)
    if (timeRemaining <= 0) {
      throw new AuthorizationError('Access has expired')
    }
    return Math.min(JWT_TTL, timeRemaining)
  }

  let expiry = timeout

  // default timeout
  if (!(timeout && isPrivilegedUser)) {
    return JWT_TTL
  }
  // never expire if timeout is negative
  if (parseInt(timeout) < 0) {
    return '9999 years'
  }
  // if timeout input is string
  if (typeof timeout === 'string') {
    const m = timeout.match(/[a-zA-Z]/)
    if (!m) {
      expiry = parseInt(timeout)
    }
  }

  return expiry
}

const signJWT = ({ email, api_access = {}, jwt_uuid, prefix, product, access_expired_at = null }, { timeout, secret = JWT_SECRET, future_access } = {}) => {
  // timeout in seconds
  const expiresIn = computeExpiry(timeout, isPrivilegedUser(email, prefix, api_access), access_expired_at)

  // TODO: remove `product` from JWT when v1 `access` is stable/universal
  const toSign = { email, api_access, jwt_uuid, prefix, product }
  // for v1+ `access` system, detach access info from JWT
  if (future_access && (api_access || {}).version > 0) {
    toSign.api_access = { version: api_access.version }
  }
  return jwt.sign(toSign, secret, { expiresIn })
}

// verify user OTP and sign JWT on success
const verifyOTP = async ({ email, otp, reset_uuid = false, product = PRODUCT_ATOM, timeout, future_access }) => {
  const { api_access, jwt_uuid, prefix, access_expired_at } = await redeemAccess({
    email,
    otp,
    reset_uuid,
    product,
  })

  return {
    token: signJWT({ email, api_access, jwt_uuid, prefix, product, access_expired_at }, { timeout, future_access }),
    api_access,
    prefix,
    product,
  }
}

const verifyJWT = token => jwt.verify(token, JWT_SECRET)

// confirm user with supplied JWT payload vs. user info from DB
const confirmUser = async ({ email, api_access, jwt_uuid, reset_uuid, product }) => {
  const userInfo = await getUserInfo({ email, product }) // TODO: remove `product` when v1 `access` is universal
  const { api_access: _access, jwt_uuid: _uuid } = userInfo
  // confirm JWT UUID integrity
  if (jwt_uuid !== _uuid) {
    throw new AuthorizationError(`Invalid UUID for user ${email}`)
  }
  // legacy v0 `access` system check
  if (!_access.version && !isEqual(_access, api_access)) {
    throw new AuthorizationError(`Invalid v0 access for user ${email}`)
  }
  if (reset_uuid) {
    const jwt_uuid = await _resetUUID({ email })
    return { ...userInfo, jwt_uuid }
  }
  return userInfo
}

// token is required
const getUserAccess = async ({ token, light, reset_uuid, targetProduct, forceLight = false, allowLight = false }) => {
  // preliminary jwt verify
  let user
  try {
    user = verifyJWT(token)
  } catch (err) {
    // wrap error and up log level so it is logged to Sentry
    throw AuthorizationError.fromError(err, { message: `Invalid JWT: ${token}`, logLevel: LOG_LEVEL_ERROR })
  }

  // payload fields existence check
  const fields = ['email', 'api_access', 'jwt_uuid']
  if (!fields.every(k => k in user)) {
    throw new AuthorizationError('JWT missing required fields in payload')
  }

  // product check
  // set product to atom if missing from jwt or falsy for backward compatibility
  // TODO: deprecated, remove when v1 `access` is universal
  user.product = user.product || PRODUCT_ATOM
  if (targetProduct) {
    const safeTargetProduct = targetProduct.toLowerCase()
    if (safeTargetProduct !== 'all' && user.product !== safeTargetProduct) {
      throw new AuthorizationError('JWT not valid for this resource')
    }
    // check accesses relative to product embedded in jwt when query param 'product' === 'all'
    // TODO: remove when v1 `access` is universal
    user.product = safeTargetProduct === 'all' ? user.product : safeTargetProduct
  }

  // force light mode if user.prefix is PREFIX_MOBILE_SDK
  if (
    typeof forceLight === 'function' ? forceLight(user) : forceLight
    || (
      typeof allowLight === 'function' ? allowLight(user) : allowLight
      && ['1', 'true'].includes((light || '').toLowerCase()) 
    )|| user.prefix === PREFIX_MOBILE_SDK
  ) {
    user.api_access.version = user.api_access.version || 0
    // TODO: for v1+ `access` system, light check means no understanding of user.api_access
    return { ...user, light: true }
    
  }
  // confirm against DB user data and return the DB version (for v1+ `access` system)
  const userDB = await confirmUser({
    ...user,
    reset_uuid: ['1', 'true'].includes((reset_uuid || '').toLowerCase()),
  })
  return { ...user, ...userDB, light: false }
}

module.exports = {
  loginUser,
  signJWT,
  verifyOTP,
  verifyJWT,
  confirmUser,
  getUserInfo,
  isPrivilegedUser,
  getUserAccess,
}
