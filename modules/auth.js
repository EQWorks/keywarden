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
const { AuthorizationError } = require('./errors')

const {
  OTP_TTL = 5 * 60 * 1000, // in milliseconds
  JWT_SECRET,
  JWT_TTL = 90 * 24 * 60 * 60, // in seconds
  APP_REVIEWER_OTP = '*'.charCodeAt(0).toString(2)
} = process.env

const getUserInfo = async ({ email, product }) => {
  product = (product || 'atom').toLowerCase()
  const selects = ['prefix', 'jwt_uuid', 'client', 'atom', 'locus']
  const { user } = await selectUser({ email, selects })
  // product access (read/write) falls back to 'atom' access if empty object
  const productAccess = Object.keys(user[product] || {}).length ? user[product] : user.atom
  return {
    ...user,
    email,
    product,
    api_access: {
      ...user.client,
      ...productAccess,
    },
  }
}

// Trade OTP for user access
const redeemAccess = async ({ email, otp, reset_uuid = false, product = 'atom' }) => {
  let { prefix, api_access = {}, jwt_uuid } = await getUserInfo({ email, product })

  if (prefix === 'appreviewer') {
    if (otp !== APP_REVIEWER_OTP) {
      throw new AuthorizationError(`Invalid passcode for ${email}`)
    }
  } else {
    await redeemOTP({ otp, email, secret: JWT_SECRET, length: 6})
  }

  // set `jwt_uuid` if not set already
  if (reset_uuid || !jwt_uuid) {
    jwt_uuid = uuidv4()
    await updateUser({ email, jwt_uuid })
  }

  return { api_access, jwt_uuid, prefix }
}

const _resetUUID = async ({ email }) => {
  const jwt_uuid = uuidv4()
  await updateUser({ email, jwt_uuid })
  return jwt_uuid
}

// update user OTP and send it along with TTL through email
// return true on success
const loginUser = async ({ user, redirect, zone='utc', product = 'ATOM', nolink }) => {
  // get user WL info
  const { rows = [] } = await getUserWL(user)

  // TODO: add logo in when email template has logo
  let { sender, company } = rows[0] || {}
  sender = sender || 'dev@eqworks.com'
  company = company || 'EQ Works'

  const { prefix: userPrefix } = await getUserInfo({ email: user })
  let res = await getUserInfo({ email: user })
  if(!res)
    return res

  // set otp and ttl (in ms)
  let otp, ttl
  if (userPrefix === 'appreviewer') {
    otp = APP_REVIEWER_OTP
    ttl = Date.now() + OTP_TTL
  } else {
    const otpObj = await claimOTP({ email: user, secret: JWT_SECRET, length: 6, minTTL: OTP_TTL, resetTTL: OTP_TTL * 2})
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
    html: magicLinkHTML({ link, otp, ttl, company, product }),
  }
  await sendMail({
    from: sender,
    to: user,
    subject: `${product} (${company}) Login`,
    ...message,
  })

  return res
}

const signJWT = (userInfo, secret = JWT_SECRET) => jwt.sign(userInfo, secret, { expiresIn: JWT_TTL })

// verify user OTP and sign JWT on success
const verifyOTP = async ({ user: email, otp, reset_uuid = false, product = 'atom', timeout }) => {
  const { api_access, jwt_uuid, prefix } = await redeemAccess({
    email,
    otp,
    reset_uuid,
    product,
  })

  // timeout in seconds
  timeout = parseInt(timeout)
  timeout = timeout >= 0 ? timeout : '9999 years' // never expire if timeout is negative
  timeout = isPrivilegedUser(email, prefix, api_access) ? timeout : JWT_TTL

  return jwt.sign(
    { email, api_access, jwt_uuid, prefix, product: product.toLowerCase() }, 
    JWT_SECRET,
    { expiresIn: timeout }
  )
}

const isPrivilegedUser = (email, prefix, api_access) => {
  // returns true if this user is high-privilege
  // A user is high privilege if they have an eqworks email, a dev stage prefix,
  // and -1 access to all api_access fields
  return Object.values(api_access).every(v => v === -1) && email.endsWith('@eqworks.com') && prefix == 'dev'
}

const verifyJWT = token => jwt.verify(token, JWT_SECRET)

// confirm user with supplied JWT payload
const confirmUser = async ({ email, api_access, jwt_uuid, reset_uuid, product }) => {
  const userInfo = await getUserInfo({ email, product })
  const { api_access: _access, jwt_uuid: _uuid } = userInfo
  // confirm both JWT UUID and api_access integrity
  if (jwt_uuid !== _uuid || !isEqual(_access, api_access)) {
    throw new AuthorizationError(`Token payload no longer valid for user ${email}`)
  }
  if (reset_uuid) {
    const uuid = await _resetUUID({ email })
    return { ...userInfo, jwt_uuid: uuid }
  }
  return userInfo
}

module.exports = {
  loginUser,
  signJWT,
  verifyOTP,
  verifyJWT,
  confirmUser,
  getUserInfo,
}
