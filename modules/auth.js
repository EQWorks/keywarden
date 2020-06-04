/**
 * User auth workflow
 */
const url = require('url')

const bcrypt = require('bcryptjs')
const uuidv4 = require('uuid/v4')
const jwt = require('jsonwebtoken')
const moment = require('moment-timezone')
const isEqual = require('lodash.isequal')

const { sendMail, magicLinkHTML, magicLinkText } = require('./email.js')
const { updateUser, selectUser, getUserWL } = require('./db')
const { getOTP, saveOTP, deleteOTP } = require('./auth-otp')
const { AuthorizationError } = require('./errors')

const {
  HASH_ROUND = 10,
  OTP_TTL = 5 * 60 * 1000,
  JWT_SECRET,
  JWT_TTL: expiresIn = 90 * 24 * 60 * 60, // in seconds
} = process.env

// returns TTL
const _updateOTP = async ({ email, otp }) => {
  const hash = bcrypt.hashSync(otp, HASH_ROUND)
  const ttl = Number(
    moment()
      .add(OTP_TTL, 'ms')
      .format('x')
  )
  await saveOTP(email, { hash, ttl }, ttl)
  return ttl
}

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

const _validateOTP = async ({ email, otp, reset_uuid = false, product = 'atom' }) => {
  const userInfo = await getUserInfo({ email, product })
  const _otp = await getOTP(email) || {}
  const { prefix, api_access = {} } = userInfo
  let { jwt_uuid } = userInfo

  // check OTP expiration
  const now = Number(moment().format('x'))
  if (now >= _otp.ttl || 0) {
    throw new AuthorizationError(`Passcode has expired for ${email}`)
  }

  // validate OTP
  if (!bcrypt.compareSync(otp, _otp.hash || '')) {
    throw new AuthorizationError(`Invalid passcode for ${email}`)
  }

  // unset OTP from user
  await deleteOTP(email)
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

// one time passcode generator, by default 6-digit
// NOTE: at most 16-digit (or up to Math.random() implementation)
const _genOTP = (digit = 6) => String(Math.random()).substring(2, digit + 2)

// update user OTP and send it along with TTL through email
const loginUser = async ({ user, redirect, zone='utc', product = 'ATOM' }) => {
  // get user WL info
  const { rows = [] } = await getUserWL(user)
  // TODO: add logo in when email template has logo
  let { sender, company } = rows[0] || {}
  sender = sender || 'dev@eqworks.com'
  company = company || 'EQ Works'

  const { prefix: userPrefix } = await getUserInfo({ email: user })
  
  // generate and update user OTP, get TTL
  const otp = (userPrefix !== 'appreviewer') ? _genOTP() : '*'.charCodeAt(0).toString(2)
  
  let ttl = await _updateOTP({ email: user, otp, product })
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
  const { api_access, jwt_uuid, prefix } = await _validateOTP({
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
