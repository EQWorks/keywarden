/**
 * Redis OTP
 */
const redis = require('redis')
const { APIError } = require('./errors')


// REDIS HELPERS
class RedisError extends APIError {
  /**
   * Create a new instance of RedisError
   * Accepts either a string (message) or an options object as unique argument
   * @param {(string|{message: string})} options
   * @return {RedisError}
   */
  constructor(options) {
    const _options = typeof options === 'string' ? { message: options } : options || {}
    super({ ..._options, statusCode: 500, logLevel: 'ERROR' })
    this.name = 'RedisError'
  }
}

// lazy init Redis client
const _redisClient = (url) => {
  let client

  const initRedisClient = (url) => {
    const retry_strategy = (options) => {
      if (options.error && options.error.code === 'ECONNREFUSED') {
        // End reconnecting on a specific error and flush all commands with
        // a individual error
        return new RedisError('The server refused the connection')
      }
      if (options.total_retry_time > 1000 * 60 * 5) {
        // End reconnecting after a specific timeout (5 mins) and flush all commands
        // with a individual error
        return new RedisError('Retry time exhausted')
      }
      if (options.attempt > 10) {
        // End reconnecting with built in error
        return new RedisError('No more tries')
      }
      // reconnect after (all in ms)
      return Math.min(options.attempt * 100, 3000)
    }

    const client = redis.createClient(url, { retry_strategy })

    client.on('error', (err) => {
      throw new RedisError(`Error with Redis client: ${err.message}`)
    })

    return client
  }

  // init and/or returns client
  return () => {
    if (!client) {
      client = initRedisClient(url)
    }
    return client
  }
}

// sets key/value/expiry and returns redis response ('OK' if successful)
// eslint-disable-next-line no-undef
const _setRedisKey = (client, key, value, options, expiry) => new Promise((resolve, reject) => {
  const args = [key, value].concat([options, expiry].filter(arg => arg))
  client.set(...args, (err, res) => {
    if (err) {
      reject(new RedisError(`Error setting the Redis key: ${err.message}`))
      return
    }
    resolve(res)
  })
})

// gets value for key and returns redis response
// eslint-disable-next-line no-undef
const _getRedisKey = (client, key) => new Promise((resolve, reject) => {
  client.get(key, (err, res) => {
    if (err) {
      reject(new RedisError(`Error getting the Redis key: ${err.message}`))
      return
    }
    resolve(res)
  })
})

// deletes key and returns redis response (1 if deleted, 0 otherwise)
// eslint-disable-next-line no-undef
const _deleteRedisKey = (client, key) => new Promise((resolve, reject) => {
  client.del(key, (err, res) => {
    if (err) {
      reject(new RedisError(`Error deleting the Redis key: ${err.message}`))
      return
    }
    resolve(res)
  })
})

// OTP EXPORTS
const getRedisClient = _redisClient(process.env.REDIS_URL)

// returns 1 if successful (mirrors db.updateUser())
const saveOTP = async (email, otp, ttl) => {
  const redisOTP = JSON.stringify(otp)
  await _setRedisKey(getRedisClient(), `keywarden-otp-${email}`, redisOTP, 'PX', ttl)
  return 1
}

// returns otp object (null if does not exist)
const getOTP = async (email) => {
  const redisOTP = await _getRedisKey(getRedisClient(), `keywarden-otp-${email}`)
  return JSON.parse(redisOTP)
}

// returns 1 if deleted, 0 otherwise
const deleteOTP = (email) => _deleteRedisKey(getRedisClient(), `keywarden-otp-${email}`)

module.exports = {
  getRedisClient,
  getOTP,
  saveOTP,
  deleteOTP,
  RedisError,
}
