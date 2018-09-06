/**
 * User auth workflow
 */
const url = require('url')

const bcrypt = require('bcryptjs')
const uuidv4 = require('uuid/v4')
const jwt = require('jsonwebtoken')
const moment = require('moment-timezone')
const { isEqual } = require('lodash')

const { sendMail, magicLinkHTML, magicLinkText } = require('./email.js')
const { updateUser, selectUser } = require('./db')

const {
  HASH_ROUND = 10,
  OTP_TTL = 5 * 60 * 1000,
  JWT_SECRET,
  JWT_TTL: expiresIn = 90 * 24 * 60 * 60, // in seconds
} = process.env

const _updateOTP = async ({ email, otp }) => {
  const hash = bcrypt.hashSync(otp, HASH_ROUND)
  const ttl = Number(moment().add(OTP_TTL, 'ms').format('x'))
  await updateUser({ email, otp: { hash, ttl }})
  return ttl
}

const _getUserInfo = async ({ email, product='atom', otp=false }) => {
  const selects = [
    'prefix',
    'jwt_uuid',
    'client',
    product,
  ]
  if (otp) {
    selects.push('otp')
  }
  const { user } = await selectUser({ email, selects })
  return {
    ...user,
    email,
    [product]: product,
    api_access: {
      ...user.client,
      ...user[product]
    },
  }
}

const _validateOTP = async ({ email, otp, reset_uuid = false }) => {
  const userInfo = await _getUserInfo({ email, otp: true })
  const {
    otp: _otp={},
    api_access={},
  } = userInfo
  let { jwt_uuid } = userInfo
  // check OTP expiration
  const now = Number(moment().format('x'))
  if (now >= _otp.ttl || 0) {
    const error = new Error(`Passcode has expired for ${email}`)
    error.statusCode = 403
    error.logLevel = 'WARNING'
    throw error
  }
  // validate OTP
  if (!bcrypt.compareSync(otp, _otp.hash || '')) {
    const error = new Error(`Invalid passcode for ${email}`)
    error.statusCode = 403
    error.logLevel = 'WARNING'
    throw error
  }
  // unset OTP from user
  const updates = { otp: {} }
  // set `jwt_uuid` if not set already
  if (reset_uuid || !jwt_uuid) {
    jwt_uuid = uuidv4()
    updates['jwt_uuid'] = jwt_uuid
  }
  await updateUser({ email, ...updates })
  return { api_access, jwt_uuid }
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
const loginUser = async ({ user, redirect, zone='utc' }) => {
  // generate and update user OTP, get TTL
  const otp = _genOTP()
  let ttl = await _updateOTP({ email: user, otp })
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
  const message = {
    from: 'dev@eqworks.com',
    to: user,
    subject: 'ATOM Login',
    text: magicLinkText(link, otp, ttl),
    html: magicLinkHTML(link, otp, ttl),
  }
  return sendMail(message)
}

const signJWT = (userInfo) => (jwt.sign(userInfo, JWT_SECRET, { expiresIn }))

// verify user OTP and sign JWT on success
const verifyOTP = async ({ user: email, otp, reset_uuid = false }) => {
  const { api_access, jwt_uuid } = await _validateOTP({ email, otp, reset_uuid })
  return signJWT({ email, api_access, jwt_uuid })
}

const verifyJWT = (token) => jwt.verify(token, JWT_SECRET)

// confirm user with supplied JWT payload
const confirmUser = async (payload) => {
  const { email, api_access, jwt_uuid, reset_uuid } = payload
  const userInfo = await _getUserInfo({ email })
  const {
    api_access: _access,
    jwt_uuid: _uuid,
  } = userInfo
  // confirm both JWT UUID and api_access integrity
  if (jwt_uuid !== _uuid || !isEqual(_access, api_access)) {
    const error = new Error(`Token payload no longer valid for user ${email}`)
    error.statusCode = 403
    error.logLevel = 'WARNING'
    throw error
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
}
