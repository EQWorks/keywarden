const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const uuidv4 = require('uuid/v4')
const moment = require('moment')

const {
  HASH_ROUND = 10,
  OTP_TTL = 5 * 60 * 1000,
} = process.env

// https://node-postgres.com/features/connecting#environment-variables
const pool = new Pool()

const updateOTP = async ({ email, otp }) => {
  const hash = bcrypt.hashSync(otp, HASH_ROUND)
  const ttl = Number(moment().add(OTP_TTL, 'ms').format('x'))
  await pool.query(`
    UPDATE equsers
    SET otp = $1
    WHERE email = $2;
  `, [{ hash, ttl }, email])
  return ttl
}

const validateOTP = async ({ email, otp, reset_uuid = false }) => {
  const userInfo = await pool.query(`
    SELECT
      otp,
      atom AS api_access,
      jwt_uuid
    FROM equsers
    WHERE email = $1;
  `, [email]).rows[0] || {}
  const {
    otp: _otp = {},
    api_access = {},
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
  const updates = ['otp = NULL']
  // set `jwt_uuid` if not set already
  if (reset_uuid || !jwt_uuid) {
    jwt_uuid = uuidv4()
    updates.push(`jwt_uuid = ${jwt_uuid}`)
  }
  // update user
  await pool.query(`
    UPDATE equsers
    SET ${updates.join(',')}
    WHERE email = $1;
  `, [email])
  return { api_access, jwt_uuid }
}

const getUserInfo = async ({ email, product='atom' }) => {
  const userInfo = await pool.query(`
    SELECT
      prefix,
      jwt_uuid,
      whitelabels,
      customers,
      ${product}
    FROM equsers
    WHERE email = $1;
  `, [email]).rows[0] || {}
  return {
    ...userInfo,
    [product]: product,
    api_access: {
      ...userInfo[product],
      wl: userInfo.whitelabels || [],
      customers: userInfo.customers || [],
    },
  }
}

const resetUUID = async ({ email }) => {
  const jwt_uuid = uuidv4()
  await pool.query(`
    UPDATE equsers
    SET jwt_uuid = $2
    WHERE email = $1
  `, [email, jwt_uuid])
  return jwt_uuid
}

module.exports = {
  updateOTP,
  validateOTP,
  getUserInfo,
  resetUUID,
}
