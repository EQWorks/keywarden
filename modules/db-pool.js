/**
 * Wrapper class around node-pg's Pool
 * Safe for aws lambda use
 * Background on the issue: https://github.com/knex/knex/issues/3636
 * Lambda Execution Context: https://docs.aws.amazon.com/lambda/latest/dg/runtimes-context.html
 */

const { Pool } = require('pg')
const { CustomError } = require('./errors')


module.exports = class DBPool {
  /**
   * Wrapper around node-pg's Pool
   * @param {pg.PoolConfig} [options] See node-pg's Pool documentation for full
   * list of options - https://node-postgres.com/features/connecting#environment-variables
   * @return {DBPool}
   */
  constructor(options) {
    this._pool = new Pool(options)
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
   * Wrapped node-pg Pool
   * @return {Pool}
   */
  get pool() {
    return this._pool
  }
}
