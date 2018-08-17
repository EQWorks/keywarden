/**
 * User management workflow
 */
const {
  listUsers,
  getUser: _getUser,
} = require('./db')

const _getConditions = ({ prefix, api_access, product='atom' }) => {
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
  return conditions
}

// list users that the given user (email) has access to
const getUsers = ({ prefix, api_access, product='atom' }) => {
  const conditions = _getConditions({ prefix, api_access, product })
  const selects = ['email', 'prefix', 'client', product]
  return listUsers({ selects, conditions })
}

// get a user by email that the given user (email) has access to
const getUser = ({ email, prefix, api_access, product='atom' }) => {
  const conditions = _getConditions({ prefix, api_access, product })
  const selects = ['email', 'prefix', 'client', product]
  return _getUser({ email, selects, conditions })
}

module.exports = {
  getUsers,
  getUser,
}
