/**
 * User database management (CRUD)
 */
const { Pool } = require('pg')
const isEmpty = require('lodash.isempty')

const { APIError } = require('./errors')

// https://node-postgres.com/features/connecting#environment-variables
const pool = new Pool()

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
    await pool.query(`
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

const updateUser = async ({ email, ...updates }) => {
  _checkEmpty({ email })
  const entries = Object.entries(updates)
  await pool.query('BEGIN;')
  const { rowCount } = await pool.query(`
    UPDATE equsers
    SET ${entries.map(([ k ], i) => `${k} = $${i + 2}`).join(',')}
    WHERE email = $1;
  `, [email, ...entries.map((a) => a[1])])
  if (rowCount === 1) {
    await pool.query('COMMIT;')
    return rowCount
  }
  if (rowCount === 0) {
    throw new APIError({ message: `User ${email} not found`, statusCode: 404, logLevel: 'WARNING' })
  }
  throw new APIError(`Update false row count: ${rowCount}`)
}

const deleteUser = (email) => {
  return pool.query(`
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
}
