/**
 * User management workflow
 */
const {
  listUsers,
} = require('./db')

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
    conditions.push(`client->'wl' <@ '${JSON.stringify(wl)}'::jsonb`)
    conditions.push(`(
      (
        prefix = 'wl'
        AND coalesce((${product}->>'read')::integer, 0) <= ${read}
        AND coalesce((${product}->>'write')::integer, 0) <= ${write}
      )
      OR prefix = 'customers'
    )`)
  } else if (prefix === 'customers') {
    conditions.push(`client->'customers' <@ '${JSON.stringify(customers)}'::jsonb`)
    conditions.push(`(
      prefix = 'customers'
      AND coalesce((${product}->>'read')::integer, 0) <= ${read}
      AND coalesce((${product}->>'write')::integer, 0) <= ${write}
    )`)
  }
  // relatively fixed selects for now
  const selects = ['email', 'prefix', 'client', product]
  return listUsers({ selects, conditions })
}

module.exports = {
  getUsers,
}
