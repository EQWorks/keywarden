/**
 * Wrapper class around node-pg's Pool
 * Safe for aws lambda use
 * Background on the issue: https://github.com/knex/knex/issues/3636
 * Lambda Execution Context: https://docs.aws.amazon.com/lambda/latest/dg/runtimes-context.html
 */

const { Pool } = require('pg')
const { CustomError, sentry } = require('./errors')


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
      if (err.code !== '57P01') {
        throw err
      }
    })
  }

  /**
   * Acquires a warm client from the pool
   * Clients with closed connections are discarded
   * @return {Promise<pg.Client>}
   */
  async _acquireClient() {
    const client = await this._pool.connect()
  
    // client.connection.stream implements stream.duplex (default net.socket)
    if (client.connection.stream.readable && client.connection.stream.writable) {
      return client
    }
  
    // else if write() and/or read() are not callable, connection is stale
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
   * @return {Promise<Any>} Promise resolving to the return value of the callback function.
   */
  async query(text, values) {
    const client = await this._acquireClient()
    try {
      // run query
      return await client.query(text, values)
  
    } finally {
      // always return the client to the pool
      client.release()
    }
  }
  
  /**
   * Perfoms SQL transactions
   * All queries are executed on the same client
   * @param {(query: (text: string, values?: Array<any>) => Promise<any>) => Promise<any>} cb
   * Async callback function taking one parameter: a function with signature and behaviour
   * identical to node-pg's Pool.prototype.query().
   * @return {Promise<Any>} Promise resolving to the return value of the callback function.
   */
  async transaction(cb) {
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
      throw err
  
    } finally {
      // always return the client to the pool
      client.release()
    }
  }

  /**
   * Returns the number of postgres sessions for the current application
   * @return {Promise<number>}
   */
  async getSessionsCount() {
    const client = await this._acquireClient()
    try {
      const applicationName = client.connectionParameters.application_name || client.connectionParameters.fallback_application_name
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
    } finally {
      // always return the client to the pool
      client.release()
    }
  }

  /**
   * Returns the number of idle postgres sessions for the current application
   * @param {number} [since=5000] Minimum idle duration (in milliseconds) 
   * @return {Promise<number>}
   */
  async getIdleSessionsCount(since = 5000) {
    const client = await this._acquireClient()
    try {
      const applicationName = client.connectionParameters.application_name || client.connectionParameters.fallback_application_name
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
    } finally {
      // always return the client to the pool
      client.release()
    }
  }

  /**
   * Terminate idle postgres sessions for the current application
   * @param {number} [since=5000] Minimum idle duration (in milliseconds) 
   * @return {Promise<number>} Promise resolving to the number of sessions terminated
   */
  async killIdleSessions(since = 5000) {
    const client = await this._acquireClient()
    try {
      const applicationName = client.connectionParameters.application_name || client.connectionParameters.fallback_application_name
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
