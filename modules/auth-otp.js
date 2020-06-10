const crypto = require('crypto')

/**
 * Returns the current unix time interval according to intervalLength
 * @param {number} [intervalLength=1000] Time interval length (in milliseconds)
 * @return {number} Current unix time interval
 */
const getTimeInterval = (intervalLength = 1000) => {
  return (Date.now() / intervalLength) >> 0
}

/**
 * Generates a TOTP with a TTL equal to the end of the current unix time interval
 * adjusted for intervalOffset
 * @param {Object} [options]
 * @param {string} options.email
 * @param {string} options.secret
 * @param {string} [options.length=6] Length of the TOTP string (max 32, multiple of 2)
 * @param {number} [options.intervalLength=1000*60*5] Time interval length (in milliseconds)
 * @param {number} [options.intervalOffset=0] Offset relative to the current unix
 * time interval (calculatd according to intervalLength)
 * @return {({ otp: string, ttl: number})} TOTP object
 */
const genTOTP = ({ email, secret, length = 6, intervalLength = 1000 * 60 * 5, intervalOffset = 0 }) => {
  const timeInterval = getTimeInterval(intervalLength) + intervalOffset
  const otp = crypto.createHmac('sha256', secret + timeInterval)
    .update(email, 'utf8')
    .digest()
    .swap64()
    .slice(- Math.ceil(length / 2))
    .toString('hex')
    .toUpperCase()
  const ttl = (timeInterval + 1) * intervalLength - 1
  
  return { otp, ttl }
}

/**
 * Returns a TOTP to expire at the end of the next unix time interval
 * @param {Object} [options]
 * @param {string} options.email
 * @param {string} options.secret
 * @param {string} [options.length=6] Length of the TOTP string (max 32, multiple of 2)
 * @param {number} [options.intervalLength=1000*60*5] Time interval length (in milliseconds)
 * @return {({ otp: string, ttl: number})} TOTP object
 */
const claimTOTP = ({ email, secret, length = 6, intervalLength = 1000 * 60 * 5 }) => {
  return genTOTP({ email, secret, length, intervalLength, intervalOffset: 1 })
}

/**
 * Checks that the supplied TOTP is valid for the current or next unix time interval
 * @param {Object} [options]
 * @param {string} options.otp OTP for which validation is sought
 * @param {string} options.email
 * @param {string} options.secret
 * @param {string} [options.length=6] Length of the TOTP string (max 32, multiple of 2)
 * @param {number} [options.intervalLength=1000*60*5] Time interval length (in milliseconds)
 * @return {boolean} true if the TOTP is valid, false otherwise
 */
const validateTOTP = ({ otp, email, secret, length = 6, intervalLength = 1000 * 60 * 5 }) => {
  // can redeeem TOTP for current and next time interval
  otp = otp.trim().toUpperCase()
  return otp === genTOTP({ email, secret, length, intervalLength, intervalOffset: 1 }).otp ||
    otp === genTOTP({ email, secret, length, intervalLength, intervalOffset: 0 }).otp
}

module.exports = {
  claimTOTP,
  validateTOTP,
}
