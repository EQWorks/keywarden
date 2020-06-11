/**
 * User auth workflow
 */
const url = require('url')

const uuidv4 = require('uuid/v4')
const jwt = require('jsonwebtoken')
const moment = require('moment-timezone')
const isEqual = require('lodash.isequal')

const { sendMail, magicLinkHTML, magicLinkText } = require('./email.js')
const { updateUser, selectUser, getUserWL } = require('./db')
const { claimTOTP, redeemTOTP } = require('./auth-otp')
const { AuthorizationError } = require('./errors')

const {
  OTP_TTL = 5 * 60 * 1000, // in milliseconds
  JWT_SECRET,
  JWT_TTL: expiresIn = 90 * 24 * 60 * 60, // in seconds
  APP_REVIEWER_OTP = '*'.charCodeAt(0).toString(2)
} = process.env

const getUserInfo = async ({ email, product = 'atom' }) => {
  const selects = ['prefix', 'jwt_uuid', 'client', product]
  const { user } = await selectUser({ email, selects })
  return {
    ...user,
    email,
    product,
    api_access: {
      ...user.client,
      ...user[product],
    },
  }
}

// Trade TOTP for user access
const validateTOTP = async ({ email, otp, reset_uuid = false, product = 'atom' }) => {
  let { prefix, api_access = {}, jwt_uuid } = await getUserInfo({ email, product })

  if (prefix === 'appreviewer') {
    if (otp !== APP_REVIEWER_OTP) {
      throw new AuthorizationError(`Invalid passcode for ${email}`)
    }
  } else {
    redeemTOTP({ otp, email, secret: JWT_SECRET, length: 6})
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
const loginUser = async ({ user, redirect, zone='utc', product = 'ATOM' }) => {
  // get user WL info
  const { rows = [] } = await getUserWL(user)
  // TODO: add logo in when email template has logo
  const { sender = 'dev@eqworks.com', company = 'EQ Works' } = rows[0] || {}

  const { prefix: userPrefix } = await getUserInfo({ email: user })
  
  // set otp and ttl (in ms)
  let otp, ttl
  if (userPrefix === 'appreviewer') {
    otp = APP_REVIEWER_OTP
    ttl = Date.now() + OTP_TTL
  } else {
    const totp = await claimTOTP({ email: user, secret: JWT_SECRET, length: 6, intervalLength: OTP_TTL})
    otp = totp.otp
    ttl = totp.ttl
  }

  // localize TTL
  ttl = moment.tz(ttl, zone).format('LLLL z')

  // parse given redirect
  let link = url.parse(redirect, true)
  // inject query string params
  link.query = link.query || {}
  Object.assign(link.query, { user, otp })
  // hack to enable link.query over ?search
  link.search = undefined
  // reconstruct into the effective magic link
  link = url.format(link)

  // populate email
  const message = {
    from: sender,
    to: user,
    subject: `${product} (${company}) Login`,
    text: magicLinkText({ link, otp, ttl, company, product }),
    html: magicLinkHTML({ link, otp, ttl, company, product }),
  }
  return sendMail(message)
}

const signJWT = (userInfo, secret = JWT_SECRET) => jwt.sign(userInfo, secret, { expiresIn })

// verify user OTP and sign JWT on success
const verifyOTP = async ({ user: email, otp, reset_uuid = false, product = 'atom' }) => {
  const { api_access, jwt_uuid, prefix } = await validateTOTP({
    email,
    otp,
    reset_uuid,
    product,
  })
  return signJWT({ email, api_access, jwt_uuid, prefix, product: product.toLowerCase() })
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
