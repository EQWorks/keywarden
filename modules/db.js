/**
 * User database management (CRUD)
 */
const { Pool } = require('pg')
const isEmpty = require('lodash.isempty')

const { APIError } = require('./errors')

// https://node-postgres.com/features/connecting#environment-variables
const pool = new Pool({ max: 1, host: process.env.PGHOST_READ })
const wPool = new Pool({ max: 1 })

/**
 * Perfoms SQL transactions
 * All queries are executed on the same client
 * @param {Pool} pool
 * @param {Function} callback - Async callback function taking one parameter: a function with signature and behaviour identical to Pool.prototype.query().
 * @return Promise resolving to the return value of the callback function.
 */
const doTransaction = async (pool, callback) => {
  const client = await pool.connect()
  try {
    // start transaction
    await client.query('BEGIN')

    // query function to be passed to the callback
    const query = (...args) => client.query(...args)
    const output = await callback(query)

    // commit if no errors
    await client.query('COMMIT')
    return output

  } catch (err) {
    // if error, rollback all changes to db and rethrow
    await client.query('ROLLBACK')
    throw err

  } finally {
    // in all instances, return the client to the pool
    client.release()
  }
}

const _checkEmpty = ({ ...params }) => {
  for (const [ k, v ] of Object.entries(params)) {
    if (isEmpty(v)) {
      throw new APIError({ message: `Required param ${k} is empty`, statusCode: 400, logLevel: 'WARNING' })
    }
  }
}

const selectUser = async ({ email, selects, conditions=[] }) => {
  _checkEmpty({ email })
  const { rows=[] } = await pool.query(`
    SELECT ${selects.join(',')}
    FROM equsers
    WHERE email = $1
      ${isEmpty(conditions) ? '' : `AND ${conditions.join(' AND ')}`}
    LIMIT 1;
  `, [email])
  const user = rows[0] || {}
  return { user }
}

const listUsers = async ({ selects, conditions }) => {
  const { rows: users=[] } = await pool.query(`
    SELECT ${selects.join(',')}
    FROM equsers
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''};
  `)
  return { users }
}

const insertUser = async ({ email, ...props }) => {
  _checkEmpty({ email })
  const entries = Object.entries({ email, ...props})
  try {
    await wPool.query(`
      INSERT INTO equsers
        (${entries.map(([ k ]) => k).join(',')})
      VALUES
        (${entries.map((_, i) => `$${i + 1}`).join(',')});
    `, entries.map((a) => a[1]))
  } catch(e) {
    // https://www.postgresql.org/docs/current/static/errcodes-appendix.html
    if (e.code === '23505') {
      throw new APIError({ message: `User ${email} already exists`, statusCode: 400, logLevel: 'WARNING' })
    }
    throw e
  }
}

// resolves to 1 if update successful
const updateUser = async ({ email, ...updates }) => {
  _checkEmpty({ email })
  const entries = Object.entries(updates)
  return await doTransaction(wPool, async (query) => {
    const { rowCount } = await query(`
      UPDATE equsers
      SET ${entries.map(([ k ], i) => `${k} = $${i + 2}`).join(',')}
      WHERE email = $1;
    `, [email, ...entries.map((a) => a[1])])

    // rollback update if error
    if (rowCount !== 1) {
      if (rowCount === 0) {
        throw new APIError({ message: `User ${email} not found`, statusCode: 404, logLevel: 'WARNING' })
      }
      throw new APIError(`Update false row count: ${rowCount}`)
    }

    return rowCount
  })

}

const deleteUser = (email) => {
  return wPool.query(`
    DELETE FROM equsers
    WHERE email = $1;
  `, [email])
}

const getUserWL = (email) => pool.query(`
  SELECT
    wl.logo,
    wl.sender,
    wl.company
  FROM whitelabel AS wl
  INNER JOIN equsers AS u
    ON u.client->'wl'->(0) = wl.whitelabelid::text::jsonb
  WHERE u.email = $1;
`, [email])

module.exports = {
  selectUser,
  listUsers,
  insertUser,
  updateUser,
  deleteUser,
  getUserWL,
  // intended mostly for select queries
  query: (...params) => pool.query(...params),
  wQuery: (...params) => wPool.query(...params),
}
