/**
 * Wrapper class around node-pg's Pool
 * Safe for aws lambda use
 * Background on the issue: https://github.com/knex/knex/issues/3636
 * Lambda Execution Context: https://docs.aws.amazon.com/lambda/latest/dg/runtimes-context.html
 */

const { Socket } = require('net')
const { Pool } = require('pg')
const { CustomError, sentry } = require('./errors')

/**
 * Checks if connection stream is both readable and writable
 * @param {pg.Client} client
 * @returns {boolean}
 */
const clientIsHealthy = (client) => {
  try {
    // Streams: https://nodejs.org/api/stream.html
    const streamHealthChecks = {
      readable: true,
      readableEnded: false,
      writable: true,
      writableEnded: false,
      writableFinished: false,
      destroyed: false,
    }
    // ok if undefined as some stream properties were only added in node 12.9.0
    // stream should be an instance of net.Socket (itself a stream.Duplex)
    return client.connection.stream instanceof Socket && Object.entries(streamHealthChecks).every(
      ([key, value]) => key in client.connection.stream ? client.connection.stream[key] === value : true
    )

  } catch (_) {
    // return false if client is malformed (i.e. connection or stream keys are missing or stream is not an object)
    return false
  }
}

module.exports = class DBPool {
  /**
   * Wrapper around node-pg's Pool
   * @param {pg.PoolConfig} [options] See node-pg's Pool documentation for full
   * list of options - https://node-postgres.com/features/connecting#environment-variables
   * @return {DBPool}
   */
  constructor(options) {
    this._pool = new Pool(options)
    this._pool.on('error', (err) => {
      // should recover from 'ADMIN SHUTDOWN' error caused when calling pg_terminate_backend()
      // https://www.postgresql.org/docs/8.0/errcodes-appendix.html
      if (err.code === '57P01') {
        // MONITOR SENTRY THEN REMOVE
        sentry().logError(new CustomError({ message: 'Client terminated successfully', name: 'DBPoolDebug', logLevel: 'DEBUG' }))
        return
      }
      // unhandled error
      throw err
    })
  }

  /**
   * Acquires a warm client from the pool
   * Clients with closed connections are discarded
   * @return {Promise<pg.Client>}
   */
  async _acquireClient() {
    // allow the node event loop to run, hit the 'close' phase and following 'polling' phase before acquiring the client
    // eslint-disable-next-line no-undef
    await new Promise((resolve) => setTimeout(() => setTimeout(resolve, 0), 0))

    const client = await this._pool.connect()
    // perform health check
    if (clientIsHealthy(client)) {
      return client
    }
    // else connection is stale
    sentry().logError(new CustomError({ message: 'Unhealthy client detected in _acquireClient() after timeout', name: 'DBPoolDebug', logLevel: 'DEBUG' }))
    try {
      await client.end()
      // acquire another client
      return this._acquireClient()
  
    } catch(err) {
      throw new CustomError({ message: `Error while acquiring DB client: ${err.message}`, name: 'ClientAcquisitionDBPoolError', logLevel: 'ERROR' })
  
    } finally {
      client.release()
    }
  }
  
  /**
   * Perfoms a single SQL querie
   * Wrapper around node-pg's Pool.prototype.query()
   * @param {string} text
   * @param {Array<any>} [values]
   * @param {number} [attempt=0] Current attempt to execute function successfully (0-based)
   * @return {Promise<Any>} Promise resolving to the return value of the callback function.
   */
  async query(text, values, attempt = 0) {
    const client = await this._acquireClient()
    try {
      // run query
      return await client.query(text, values)

    } catch (err) {
      // if client is not healthy, try again with new client
      // TODO: if needed add a maxAtempts option
      if (attempt === 0 && !clientIsHealthy(client)) {
        sentry().logError(new CustomError({ message: `Unhealthy client detected in query phase: ${err.message}`, name: 'DBPoolDebug', logLevel: 'DEBUG' }))
        return this.query(text, values, attempt + 1)
      }
      throw err

    } finally {
      // always return the client to the pool
      client.release()
    }
  }
  
  /**
   * Perfoms a SQL transaction
   * All queries are executed on the same client
   * @param {(query: (text: string, values?: Array<any>) => Promise<any>) => Promise<any>} cb
   * Async callback function taking one parameter: a function with signature and behaviour
   * identical to node-pg's Pool.prototype.query().
   * @param {number} [attempt=0] Current attempt to execute function successfully (0-based)
   * @return {Promise<Any>} Promise resolving to the return value of the callback function.
   */
  async transaction(cb, attempt = 0) {
    const client = await this._acquireClient()
    try {
      // start transaction
      await client.query('BEGIN')
  
      // query function to be passed to the callback
      const query = (...args) => client.query(...args)
      const output = await cb(query)
  
      // commit if no errors
      await client.query('COMMIT')
      return output
  
    } catch (err) {
      // if error, rollback all changes to db and rethrow
      await client.query('ROLLBACK')

      // if client is not healthy, try again with new client
      if (attempt === 0 && !clientIsHealthy(client)) {
        sentry().logError(new CustomError({ message: `Unhealthy client detected in query phase: ${err.message}`, name: 'DBPoolDebug', logLevel: 'DEBUG' }))
        return this.transaction(cb, attempt + 1)
      }

      throw err
  
    } finally {
      // always return the client to the pool
      client.release()
    }
  }

  /**
   * Returns the number of postgres sessions for the current application
   * @param {number} [attempt=0] Current attempt to execute function successfully (0-based)
   * @return {Promise<number>}
   */
  async getSessionsCount(attempt = 0) {
    const client = await this._acquireClient()
    const applicationName = client.connectionParameters.application_name || client.connectionParameters.fallback_application_name
    try {
      if (!applicationName) {
        throw new CustomError({
          message: 'Missing \'application_name\' and \'fallback_application_name\' parameters. Can only get clients at the application level.',
          name: 'SessCountDBPoolError',
          logLevel: 'ERROR',
        })
      }
      const { rows: [{ total = 0 }] = [{}] } = await client.query(`
        SELECT COUNT(pid) as total
        FROM pg_catalog.pg_stat_activity
        WHERE application_name = $1;
      `,
      [applicationName])
      return total

    } catch (err) {
      // if client is not healthy, try again with new client
      if (applicationName && attempt === 0 && !clientIsHealthy(client)) {
        sentry().logError(new CustomError({ message: `Unhealthy client detected in query phase: ${err.message}`, name: 'DBPoolDebug', logLevel: 'DEBUG' }))
        return this.getSessionsCount(attempt + 1)
      }
      throw err

    } finally {
      // always return the client to the pool
      client.release()
    }
  }

  /**
   * Returns the number of idle postgres sessions for the current application
   * @param {number} [since=5000] Minimum idle duration (in milliseconds)
   * @param {number} [attempt=0] Current attempt to execute function successfully (0-based)
   * @return {Promise<number>}
   */
  async getIdleSessionsCount(since = 5000, attempt = 0) {
    const client = await this._acquireClient()
    const applicationName = client.connectionParameters.application_name || client.connectionParameters.fallback_application_name
    try {
      if (!applicationName) {
        throw new CustomError({
          message: 'Missing \'application_name\' and \'fallback_application_name\' parameters. Can only get idle clients at the application level.',
          name: 'IdleSessCountDBPoolError',
          logLevel: 'ERROR',
        })
      }
      const { rows: [{ idle = 0 }] = [{}] } = await client.query(`
        SELECT COUNT(pid) as idle
        FROM pg_catalog.pg_stat_activity
        WHERE
          application_name = $1 AND
          state = 'idle' AND
          state_change < now() - ($2 || ' milliseconds')::interval;
      `,
      [applicationName, since])
      return idle

    } catch (err) {
      // if client is not healthy, try again with new client
      if (applicationName && attempt === 0 && !clientIsHealthy(client)) {
        sentry().logError(new CustomError({ message: `Unhealthy client detected in query phase: ${err.message}`, name: 'DBPoolDebug', logLevel: 'DEBUG' }))
        return this.getIdleSessionsCount(since, attempt + 1)
      }
      throw err

    } finally {
      // always return the client to the pool
      client.release()
    }
  }

  /**
   * Terminates idle postgres sessions for the current application
   * @param {number} [since=5000] Minimum idle duration (in milliseconds)
   * @param {number} [attempt=0] Current attempt to execute function successfully (0-based)
   * @return {Promise<number>} Promise resolving to the number of sessions terminated
   */
  async killIdleSessions(since = 5000, attempt = 0) {
    const client = await this._acquireClient()
    const applicationName = client.connectionParameters.application_name || client.connectionParameters.fallback_application_name
    try {
      if (!applicationName) {
        throw new CustomError({
          message: 'Missing \'application_name\' and \'fallback_application_name\' parameters. Can only kill idle clients at the application level.',
          name: 'KillIdleSessDBPoolError',
          logLevel: 'ERROR',
        })
      }
      // pg_terminate_backend terminates a session. Can only terminate a session owned by current user unless superuser
      // https://docs.aws.amazon.com/redshift/latest/dg/PG_TERMINATE_BACKEND.html
      const { rows: [{ cancelled = 0 }] = [{}] } = await client.query(`
        SELECT COALESCE(SUM(pg_terminate_backend(pid)::int), 0) AS cancelled
        FROM pg_catalog.pg_stat_activity
        WHERE
          application_name = $1 AND
          state = 'idle' AND
          state_change < now() - ($2 || ' milliseconds')::interval;
      `,
      [applicationName, since])
      return cancelled

    } catch (err) {
      // if client is not healthy, try again with new client
      if (applicationName && attempt === 0 && !clientIsHealthy(client)) {
        sentry().logError(new CustomError({ message: `Unhealthy client detected in query phase: ${err.message}`, name: 'DBPoolDebug', logLevel: 'DEBUG' }))
        return this.killIdleSessions(since, attempt + 1)
      }
      throw err

    } finally {
      // always return the client to the pool
      client.release()
    }
  }

  /**
   * Returns Express middleware function to terminate idle postgres sessions for the current application
   * @param {Object} [options]
   * @param {number} [options.maxSessions=10] Maximum number of sessions allowed for the application at all times
   * @param {number} [options.threshold=0.8] Ratio of active sessions to maximum sessions to exceed before killing idle sessions
   * @param {number} [options.since=5000] Minimum idle duration for a session to be considered for termination (in milliseconds)
   * @param {number} [options.frequency=0.01] Frequency at which the termination process should run on exit (e.g. 0.01 -> 1% of the time)
   * @return {Function} Middleware function
   */
  killIdleSessionsOnExit({ maxSessions = 10, threshold = 0.8, since = 5000, frequency = 0.01 } = {}) {
    return (_, res, next) => {
      const listener = () => {
        const exit = Math.random() > frequency
        if (exit) {
          return
        }
        
        return this.getSessionsCount()
          .then((sessions) => sessions / maxSessions >= threshold)
          .then((proceed) => proceed ? this.killIdleSessions(since) : 0)
          // eslint-disable-next-line no-console
          .then((count) => console.log(`${count} idle clients have been terminated`))
          // log all errors to Sentry
          .catch(sentry().logError)
      }
      // attach listener to exit events
      // in cases where both events fire, frequency will 2x
      res.on('finish', listener) // this is legacy
      res.on('close', listener)
      next()
    }
  }

  /**
   * Wrapped node-pg Pool
   * @return {Pool}
   */
  get pool() {
    return this._pool
  }
}
