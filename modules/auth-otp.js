const crypto = require('crypto')
const Redis = require('ioredis')
const { AuthorizationError } = require('./errors')

const redisClient = new Redis(process.env.REDIS_URI)

// gets key or sets value if does not exist + sets/resets ttl (when ttl args provided)
redisClient.defineCommand('getOrSet', {
  numberOfKeys: 1,
  lua: `
    -- look up ttl to determine existence + if within min ttl
    local ttl = redis.call('PTTL', KEYS[1])

    if ARGV[2] ~= nil and ARGV[2] ~= "" and ARGV[3] ~= nil and ARGV[3] ~= "" and ttl < tonumber(ARGV[2]) then
      -- set key if ttl args have been provided and ttl is less than minTTL (including evergreen or nil key)
      ttl = tonumber(ARGV[3])
      redis.call('SET', KEYS[1], ARGV[1], 'PX', ttl)
      return {ARGV[1], ttl}

    elseif ttl == -2 then
      -- set ttl to -1 (no expiry) if new key with no ttl args
      ttl = -1
      redis.call('SET', KEYS[1], ARGV[1])
      return {ARGV[1], ttl}
    end

    -- otherwise return key
    return {redis.call('GET', KEYS[1]), ttl}
  `,
})

/**
 * Sets the user's TUK (Temporary User Key) to the value provided if no TUK can be
 * found in cache or if the existing TUK's TTL is less than the minimum TTL.
 * Returns cached value along with TTL
 * @param {Object} [options]
 * @param {string} options.email
 * @param {string} options.set Value to set the TUK to when the cache is empty
 * @param {number} [options.minTTL] Minimum TTL (in milliseconds) required to keep existing TUK
 * @param {number} [options.resetTTL] TTL (in milliseconds) when TUK is replaced
 * @return {Promise<{tuk: string, ttl: number}>} TTL expressed as time since unix epoch in
 * milliseconds or -1 if evergreen
 */
const getOrSetTUK = async ({ email, set, minTTL, resetTTL}) => {
  const [tuk, ttl] = await redisClient.getOrSet(`keywarden-otp-${email}`, set, minTTL, resetTTL)
  return { tuk, ttl: ttl > 0 ? Date.now() + ttl : ttl }
}

/**
 * Retrieves the user's TUK (Temporary User Key) from cache
 * @param {string} email
 * @return {string|undefined} TUK, undefined if none cached
 */
const getTUK = async (email) => {
  const tuk = await redisClient.get(`keywarden-otp-${email}`)
  return tuk || undefined
}

/**
 * Deletes the user's TUK (Temporary User Key) from cache
 * @param {string} email
 * @return {Promise<boolean>} true if the key was deleted, false otherwise
 */
const clearTUK = async (email) => {
  const deleted = await redisClient.del(`keywarden-otp-${email}`)
  return deleted === 1
}

/**
 * Generates a OTP in a deterministic way
 * @param {Object} [options]
 * @param {string} options.email
 * @param {string} options.secret
 * @param {string} options.tuk Temporary user key
 * @param {number} [options.length=6] Length of the OTP string (max 32, multiple of 2)
 * @return {string} OTP
 */
const genOTP = ({ email, secret, tuk, length = 6 }) => {
  return crypto.createHmac('sha256', secret + tuk)
    .update(email, 'utf8')
    .digest()
    .swap64()
    .slice(- Math.ceil(length / 2))
    .toString('hex')
    .toUpperCase()
}

/**
 * Generates a TUK
 * @param {number} [length=20] Length of the TUK string (multiple of 2)
 * @return {string} TUK
 */
const genTUK = (length = 20 ) => crypto.randomBytes(Math.ceil(length / 2)).toString('hex')

/**
 * Generates a OTP with a TTL in the range [minTTL, resetTTL] or no TTL (evergreen) if
 * these arguments are not supplied
 * @param {Object} [options]
 * @param {string} options.email
 * @param {string} options.secret
 * @param {number} [options.length=6] Length of the OTP string (max 32, multiple of 2)
 * @param {number} [options.minTTL] Min TTL (in milliseconds) left to reuse previously issued OTP
 * @param {number} [options.resetTTL] TTL (in milliseconds) for newly issued OTP
 * @return {Promise<{otp: string, ttl: number}>} OTP object
 * @throws {AuthorizationError} Throws if failure
 */
const claimOTP = async ({ email, secret, length = 6, minTTL, resetTTL }) => {
  const set = genTUK()
  const { tuk, ttl } = await getOrSetTUK({ email, set, minTTL, resetTTL })
  const otp = genOTP({ email, secret, tuk, length })
  return { otp, ttl }
}

/**
 * Validates the supplied OTP using the cached TUK
 * @param {Object} [options]
 * @param {string} options.otp OTP for which validation is sought
 * @param {string} options.email
 * @param {string} options.secret
 * @param {number} [options.length=6] Length of the OTP string (max 32, multiple of 2)
 * @return {Promise<undefined>}
 * @throws {AuthorizationError} Throws if failure
 */
const redeemOTP = async ({ otp, email, secret, length = 6 }) => {
  const tuk = await getTUK(email)
  // if no TUK, then all OTP have been redeemed or have expired
  if (!tuk) {
    throw new AuthorizationError(`No OTP to redeem for user ${email}`)
  }
  if (genOTP({ email, secret, tuk, length }) !== otp.trim().toUpperCase()) {
    throw new AuthorizationError(`Invalid OTP for user ${email}`)
  }
  await clearTUK(email)
}

module.exports = {
  claimOTP,
  redeemOTP,
}
