const crypto = require('crypto')
const Redis = require('ioredis')
const { AuthorizationError } = require('./errors')

const redisClient = new Redis(process.env.REDIS_URI)

// updates redis TOTP meta atomically
redisClient.defineCommand('updateCurrentTOTPMeta', {
  numberOfKeys: 1,
  lua: `
    -- get time interval and otp index
    local currentInterval = ARGV[1]
    local currentIndex = ARGV[2]
    local listLength = redis.call('LLEN', KEYS[1])

    if listLength == 2 then
      currentInterval = redis.call('LINDEX', KEYS[1], 0)
      currentIndex = redis.call('LINDEX', KEYS[1], 1)
    end

    -- return false if not expected values
    if currentInterval ~= ARGV[1] or currentIndex ~= ARGV[2] then
      return false
    end

    -- update or set otp interval + index
    if listLength == 2 then
      redis.call('LSET', KEYS[1], 0, ARGV[3])
      redis.call('LSET', KEYS[1], 1, ARGV[4])
    else
      redis.call('RPUSH', KEYS[1], ARGV[3])
      redis.call('RPUSH', KEYS[1], ARGV[4])
    end

    -- set/update ttl
    if ARGV[5] ~= nil and ARGV[5] ~= "" then
      redis.call('PEXPIREAT', KEYS[1], ARGV[5])
    end

    return true
  `
})

// get TOTP meta from redis
redisClient.defineCommand('getCurrentTOTPMeta', {
  numberOfKeys: 1,
  lua: `
    local interval = 0
    local index = 0

    if redis.call('LLEN', KEYS[1]) == 2 then
      interval = redis.call('LINDEX', KEYS[1], 0)
      index = redis.call('LINDEX', KEYS[1], 1)
    end

    return {interval, index}
  `
})

/**
 * Updates cached TOTP meta data atomically
 * @param {Object} [options]
 * @param {string} options.email
 * @param {number} [options.currentInterval=0] Time interval for the last issued TOTP
 * @param {number} [options.currentIndex=0] Index with time interval for the last issues TOTP
 * @param {number} options.nextInterval Time interval to update to
 * @param {number} [options.nextIndex=0] Index to update to
 * @param {number} [options.ttl] Unix epoch time (in milliseconds) after which the cache will clear
 * @return {Promise<undefined>}
 * @throws {AuthorizationError} Throws if failure
 */
const updateRedeemableTOTPMeta = async ({ email, currentInterval = 0, currentIndex = 0, nextInterval, nextIndex = 0, ttl}) => {
  const success = await redisClient.updateCurrentTOTPMeta(`keywarden-totp-${email}`, currentInterval, currentIndex, nextInterval, nextIndex, ttl)
  if (!success) {
    throw new AuthorizationError('Failed to update Redis cache for OTP.')
  }
}

/**
 * Retrieves cached TOTP meta data for TOTP currently redeemable (i.e. last issued within TTL)
 * @param {string} email
 * @return {Promise<{interval: number, index: number}>} { interval: 0, index: 0 } if no TOTP issued and within TTL
 */
const getRedeemableTOTPMeta = async (email) => {
  const [interval, index] = await redisClient.getCurrentTOTPMeta(`keywarden-totp-${email}`)
  return { interval: parseInt(interval, 10), index: parseInt(index, 10) }
}

/**
 * Returns the current unix time interval according to intervalLength
 * @param {number} [intervalLength=1000] Time interval length (in milliseconds)
 * @return {number} Current unix time interval
 */
const getTimeInterval = (intervalLength = 1000) => {
  return (Date.now() / intervalLength) >> 0
}

/**
 * Generates a TOTP
 * @param {Object} [options]
 * @param {string} options.email
 * @param {string} options.secret
 * @param {number} options.interval Unix time interval index
 * @param {number} [options.length=6] Length of the TOTP string (max 32, multiple of 2)
 * @param {number} [options.index=0] TOTP index within the time interval
 * @return {string} TOTP
 */
const genTOTP = ({ email, secret, interval, length = 6, index = 0 }) => {
  return crypto.createHmac('sha256', secret + interval + index)
    .update(email, 'utf8')
    .digest()
    .swap64()
    .slice(- Math.ceil(length / 2))
    .toString('hex')
    .toUpperCase()
}

/**
 * Generates a TOTP with a TTL of intervalLength
 * @param {Object} [options]
 * @param {string} options.email
 * @param {string} options.secret
 * @param {number} [options.length=6] Length of the TOTP string (max 32, multiple of 2)
 * @param {number} [options.intervalLength=1000*60*5] Time interval length (in milliseconds)
 * @return {Promise<{ otp: string, ttl: number}>} TOTP object
 * @throws {AuthorizationError} Throws if failure
 */
const claimTOTP = async ({ email, secret, length = 6, intervalLength = 1000 * 60 * 5 }) => {
  const { interval: currentInterval, index: currentIndex } = await getRedeemableTOTPMeta(email)
  const nextInterval = getTimeInterval(intervalLength) + 1
  const nextIndex = currentInterval === nextInterval ? currentIndex : 0

  const otp = genTOTP({ email, secret, interval: nextInterval, length, index: nextIndex })
  const ttl = (nextInterval + 1) * intervalLength - 1

  if (currentInterval !== nextInterval || currentIndex !== nextIndex) {
    await updateRedeemableTOTPMeta({ email, currentInterval, currentIndex, nextInterval, nextIndex, ttl })
  }

  return { otp, ttl }
}

/**
 * Validates the supplied TOTP against TOTP in cache and updates cache value to next index
 * @param {Object} [options]
 * @param {string} options.otp TOTP for which validation is sought
 * @param {string} options.email
 * @param {string} options.secret
 * @param {number} [options.length=6] Length of the TOTP string (max 32, multiple of 2)
 * @return {Promise<undefined>}
 * @throws {AuthorizationError} Throws if failure
 */
const redeemTOTP = async ({ otp, email, secret, length = 6 }) => {
  const { interval, index } = await getRedeemableTOTPMeta(email)
  if (!interval) {
    throw new AuthorizationError(`No TOTP currently valid for user ${email}`)
  }
  if (genTOTP({ email, secret, interval, length, index }) !== otp.trim().toUpperCase()) {
    throw new AuthorizationError(`Invalid TOTP for user ${email}`)
  }
  await updateRedeemableTOTPMeta({ email, currentInterval: interval, currentIndex: index, nextInterval: interval, nextIndex: index + 1 })
}

module.exports = {
  claimTOTP,
  redeemTOTP
}
