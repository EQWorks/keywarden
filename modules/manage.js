/**
 * User management workflow
 */
const {
  listUsers,
  insertUser,
  updateUser,
  removeUser,
} = require('./users/db')

// list users that the given user (email) has access to
const getUsers = ({ prefix, api_access, product='atom' }) => {
  // derive select conditions based on prefix and api_access
  const {
    wl=[],
    customers=[],
    read=0,
    write=0,
  } = api_access
  const conditions = []
  if (prefix === 'wl') {
    conditions.push(`${product}->'wl' <@ '${JSON.stringify(wl)}'::jsonb`)
    conditions.push(`(
      (
        prefix = 'wl'
        AND (${product}->>'read')::integer <= ${read}
        AND (${product}->>'write')::integer <= ${write}
      )
      OR prefix = 'customers'
    )`)
  } else if (prefix === 'customers' && cu !== -1 && cu.length) {
    conditions.push(`${product}->'customers' <@ '${JSON.stringify(customers)}'::jsonb`)
    conditions.push(`(
      prefix = 'customers'
      AND (${product}->>'read')::integer <= ${read}
      AND (${product}->>'write')::integer <= ${write}
    )`)
  }
  // relatively fixed selects for now
  const selects = ['email', 'prefix', product]
  return listUsers({ selects, conditions })
}

module.exports = {
  getUsers,
}
