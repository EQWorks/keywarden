/**
 * Authentication and authorization workflow
 */
const url = require('url')

const jwt = require('jsonwebtoken')
const moment = require('moment-timezone')
const nodemailer = require('nodemailer')
const AWS = require('aws-sdk')
const { isEqual } = require('lodash')

const { magicLinkHTML, magicLinkText } = require('./email.js')
const {
  updateOTP,
  validateOTP,
  getUserInfo,
  resetUUID,
} = require('./users/security.js')

const {
  JWT_SECRET,
  JWT_TTL: expiresIn = 90 * 24 * 60 * 60, // in seconds
} = process.env

// one time passcode generator, by default 6-digit
// NOTE: at most 16-digit (or up to Math.random() implementation)
const genOTP = (digit = 6) => String(Math.random()).substring(2, digit + 2)

// update user OTP and send it along with TTL through email
const loginUser = async ({ user, redirect, zone='utc' }) => {
  // generate and update user OTP, get TTL
  const otp = genOTP()
  let ttl = await updateOTP({ email: user, otp })
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
  return nodemailer.createTransport({
    SES: new AWS.SES()
  }).sendMail(message)
}

const signJWT = (userInfo) => (jwt.sign(userInfo, JWT_SECRET, { expiresIn }))

// verify user OTP and sign JWT on success
const verifyOTP = async ({ user: email, otp, reset_uuid = false }) => {
  const { api_access, jwt_uuid } = await validateOTP({ email, otp, reset_uuid })
  return signJWT({ email, api_access, jwt_uuid })
}

const verifyJWT = (token) => jwt.verify(token, JWT_SECRET)

// confirm user with supplied JWT payload
const confirmUser = async (payload) => {
  const { email, api_access, jwt_uuid, reset_uuid } = payload
  const userInfo = await getUserInfo({ email })
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
    const uuid = await resetUUID({ email })
    return { ...userInfo, uuid }
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
