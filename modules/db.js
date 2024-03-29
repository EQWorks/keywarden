/**
 * User database management (CRUD)
 */
const isEmpty = require('lodash.isempty')

const DBPool = require('./db-pool')
const { APIError, sentry } = require('./errors')

const rPool = new DBPool({ max: 1, host: process.env.PGHOST_READ, errorLogger: sentry().logError })
const wPool = new DBPool({ max: 1, errorLogger: sentry().logError })

const _checkEmpty = ({ ...params }) => {
  for (const [ k, v ] of Object.entries(params)) {
    if (isEmpty(v)) {
      throw new APIError({ message: `Required param ${k} is empty`, statusCode: 400, logLevel: 'WARNING' })
    }
  }
}

const selectUser = async ({ email, selects, conditions = [] }) => {
  // returns user data, or undefined if user not found
  _checkEmpty({ email })
  const { rows = [] } = await rPool.query(`
    SELECT ${selects.join(',')}
    FROM equsers
    WHERE email = $1
      ${isEmpty(conditions) ? '' : `AND ${conditions.join(' AND ')}`}
    LIMIT 1;
  `, [email])
  return rows[0]
}

const listUsers = async ({ selects, conditions }) => {
  const { rows: users=[] } = await rPool.query(`
    SELECT ${selects.join(',')}
    FROM equsers
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''};
  `)
  return { users }
}

const insertUser = async ({ email, ...props }) => {
  _checkEmpty({ email })
  const entries = Object.entries({ email, ...props })
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
  return await wPool.transaction(async (query) => {
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

const deleteUser = (email) => wPool.query(`
  DELETE FROM equsers
  WHERE email = $1;
`, [email])

const getUserWL = (email) => rPool.query(`
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
  rQuery: (...params) => rPool.query(...params),
  wQuery: (...params) => wPool.query(...params),
  // middleware functions to kill idle sessions
  // on exit 1% of the time, kill sessions that have been idle for more than 2 seconds
  // and when there are more than 12 active sessions (0.6 * 20)
  rKillIdleOnExit: rPool.killIdleSessionsOnExit({ maxSessions: 20, threshold: 0.6, since: 2000, frequency: 0.01 }),
  wKillIdleOnExit: wPool.killIdleSessionsOnExit({ maxSessions: 20, threshold: 0.6, since: 2000, frequency: 0.01 }),
}