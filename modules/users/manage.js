/**
 * User database management (CRUD)
 */

const isEmpty = require('lodash.isempty')

const db = require('./db')

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
  return db.query(`
    SELECT ${selects.join(',')}
    FROM equsers
    WHERE email = $1;
  `, [email])
}

const insertUser = ({ email, ...props }) => {
  _checkEmpty({ email })
  const entries = Object.entries({ email, ...props})
  return db.query(`
    INSERT INTO equsers
      (${entries.map(([ k ]) => k).join(',')})
    VALUES
      (${entries.map((_, i) => `$${i + 1}`).join(',')}));
  `, entries.map((a) => a[1]))
}

const updateUser = async ({ email, ...updates }) => {
  _checkEmpty({ email })
  const entries = Object.entries(updates)
  await db.query('BEGIN;')
  const { rowCount } = await db.query(`
    UPDATE equsers
    SET ${entries.map(([ k ], i) => `${k} = $${i + 2}`).join(',')}
    WHERE email = $1;
  `, [email, ...entries.map((a) => a[1])])
  if (rowCount === 1) {
    return await db.query('COMMIT;')
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
    return db.query(`
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
  insertUser,
  updateUser,
  removeUser,
}
