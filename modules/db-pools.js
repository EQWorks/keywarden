/**
 * Node-pg pools
 */

const { Pool } = require('pg')
const { CustomError, sentry } = require('./errors')

class DB {
  constructor() {
    this.reset()
  }

  /**
   * Reinstantiate read and write pools
   * @return {DB}
   */
  reset() {
    // https://node-postgres.com/features/connecting#environment-variables
    this._read = new Pool({ max: 1, host: process.env.PGHOST_READ })
    this._write = new Pool({ max: 1})
    this.isEnded = false
    return this
  }

  /**
   * Call .end() on pools
   * @return {Promise<boolean>} - Resolves to true if at least one pool was ended, false otherwise
   */
  async end() {
    try {
      // return false if all pools already ended
      if (this.isEnded) {
        return false
      }
      const pools = [this._read, this._write]
      // eslint-disable-next-line no-undef
      const results = await Promise.all(pools.map(async pool => {
        if (pool.ending) {
          return false
        }
        await pool.end()
        return true
      }))
      this.isEnded = true
      return results.some((didEnd => didEnd))
    } catch (err) {
      throw new CustomError({message: `Error while ending pools: ${err.message}`, name: 'EndDBPoolError'})
    }
  }

  /**
   * End and reset 'used' pools (i.e. pools with clients or 'ended' pools)
   * Call .end() on pools (if not ended) and instantiate new pools
   * @return {Promise<boolean>} - Resolves to true if reset was performed, false otherwise
   */
  async endAndReset() {
    try {
      if (this.isEnded || this.totalCount) {
        if (!this.isEnded) {
          // end pools if needed
          await this.end()
        }
        // instantiate r/w pools
        this.reset()
        return true
      }
      return false
    } catch (err) {
      throw new CustomError({ message: `Error resetting pools: ${err.message}`, name: 'ResetDBPoolError' })
    }
  }

  /**
   * Returns Express middleware to perform pool setup/teardown  
   * @param {boolean} onEntry - If 'true', any 'used' pool will be ended and all pools will be reinstantiated with each incoming server request 
   * @param {boolean} onFinish - If 'true', all pools will be ended (connections will be closed) with each server response 
   * @return {Function} - middleware
   */
  flush(onEntry = true, onFinish = true) {
    return (_, res, next) => {
      // end pools on finish
      if (onFinish) {
        // register listeners
        const listener = () => this.end()
          .catch((err) => {
            // log all errors to Sentry
            sentry().logError(err)
          })
        res.on('finish', listener) // this is legacy
        res.on('close', listener)
      }

      // end pools (connections) if necessary + instantiate fresh pools
      if (onEntry) {
        this.endAndReset()
          .then((didReset) => {
            // log to sentry if pools had to be reset on entry
            if (didReset) {
              sentry().logError(new CustomError({message: 'DB pool persisted between requests and was reset on application entry.', name: 'PersistentDBPoolError', logLevel: 'WARNING'}))
            }
            next()
          })
          .catch(next)
        return
      }
      
      next()
    }
  }

  /**
   * Total number of clients in all pools
   * @return {number}
   */
  get totalCount() {
    return this._write.totalCount + this._read.totalCount
  }

  /**
   * Read pool
   * @return {Pool}
   */
  get read() {
    return this._read
  }

  /**
   * Alias for the read pool
   * @return {Pool}
   */
  get r() {
    return this.read
  }

  /**
   * Write pool
   * @return {Pool}
   */
  get write() {
    return this._write
  }

  /**
   * Alias for the write pool
   * @return {Pool}
   */
  get w() {
    return this.write
  }

}

module.exports = new DB()