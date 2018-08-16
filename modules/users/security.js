const bcrypt = require('bcryptjs')
const uuidv4 = require('uuid/v4')
const moment = require('moment')

const {
  updateUser,
  getUser,
} = require('./db')

const {
  HASH_ROUND = 10,
  OTP_TTL = 5 * 60 * 1000,
} = process.env

const updateOTP = async ({ email, otp }) => {
  const hash = bcrypt.hashSync(otp, HASH_ROUND)
  const ttl = Number(moment().add(OTP_TTL, 'ms').format('x'))
  await updateUser({ email, otp: { hash, ttl }})
  return ttl
}

const getUserInfo = async ({ email, product='atom', otp=false }) => {
  const selects = [
    'prefix',
    'jwt_uuid',
    product,
  ]
  if (otp) {
    selects.push('otp')
  }
  const { rows=[] } = await getUser(email, ...selects)
  const userInfo = rows[0] || {}
  return {
    ...userInfo,
    [product]: product,
    api_access: userInfo[product],
  }
}

const validateOTP = async ({ email, otp, reset_uuid = false }) => {
  const userInfo = await getUserInfo({ email, otp: true })
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

const resetUUID = async ({ email }) => {
  const jwt_uuid = uuidv4()
  await updateUser({ email, jwt_uuid })
  return jwt_uuid
}

module.exports = {
  updateOTP,
  validateOTP,
  getUserInfo,
  resetUUID,
}
