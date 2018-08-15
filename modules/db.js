/**
 * pg :singleton:
 *
 * ref: https://node-postgres.com/guides/project-structure
 */
const { Pool } = require('pg')
// https://node-postgres.com/features/connecting#environment-variables
const pool = new Pool()

module.exports = {
  query: (...props) => pool.query(...props),
}
