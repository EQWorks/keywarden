/**
 * User database management (CRUD)
 */
const { Pool } = require('pg')
const isEmpty = require('lodash.isempty')

// https://node-postgres.com/features/connecting#environment-variables
const pool = new Pool()

const _checkEmpty = ({ ...params }) => {
  for (const [ k, v ] of Object.entries(params)) {
    if (isEmpty(v)) {
      const error = new Error(`Required param ${k} is empty`)
      error.statusCode = 400
      error.logLevel = 'WARNING'
      throw error
    }
  }
}

const getUser = (email, ...selects) => {
  _checkEmpty({ email })
  return pool.query(`
    SELECT ${selects.join(',')}
    FROM equsers
    WHERE email = $1;
  `, [email])
}

const listUsers = async ({ selects, conditions }) => {
  const text = `
    SELECT ${selects.join(',')}
    FROM equsers
    WHERE ${conditions.join(' AND ')};
  `
  // TODO: remove this
  console.log(text)
  const { rows=[] } = await pool.query(text)
  return rows
}

const insertUser = ({ email, ...props }) => {
  _checkEmpty({ email })
  const entries = Object.entries({ email, ...props})
  return pool.query(`
    INSERT INTO equsers
      (${entries.map(([ k ]) => k).join(',')})
    VALUES
      (${entries.map((_, i) => `$${i + 1}`).join(',')}));
  `, entries.map((a) => a[1]))
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
    return await pool.query('COMMIT;')
  }
  let error
  if (rowCount === 0) {
    error = new Error(`User ${email} not found`)
    error.statusCode = 404
    error.logLevel = 'WARNING'
  } else {
    error = new Error(`Update false row count: ${rowCount}`)
    error.statusCode = 500
    error.logLevel = 'ERROR'
  }
  throw error
}

// deactivate/remove
const removeUser = ({ email, hard=false }) => {
  if (hard) {
    return pool.query(`
      DELETE FROM equsers
      WHERE email = $1;
    `, [email])
  }
  return updateUser({
    email,
    jwt_uuid: null,
    active: 0,
  })
}

module.exports = {
  getUser,
  listUsers,
  insertUser,
  updateUser,
  removeUser,
}
