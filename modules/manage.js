/**
 * User management workflow
 */
const {
  listUsers,
  selectUser,
  insertUser,
  updateUser,
  deleteUser,
} = require('./db')
const RESOURCES = [
  'read',
  'write',
  'fin',
]

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
    if (wl !== -1) {
      conditions.push(`client->'wl' <@ '${JSON.stringify(wl)}'::jsonb`)
    }
    conditions.push(`(
      (
        prefix = 'wl'
        AND coalesce((${product}->>'read')::integer, 0) <= ${read}
        AND coalesce((${product}->>'write')::integer, 0) <= ${write}
      )
      OR prefix = 'customers'
    )`)
  } else if (prefix === 'customers') {
    if (customers !== -1) {
      conditions.push(`client->'customers' <@ '${JSON.stringify(customers)}'::jsonb`)
    }
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
  return selectUser({ email, selects, conditions })
}

const _checkPrefix = ({ userPrefix, prefix }) => {
  if (prefix === 'wl') {
    return ['wl', 'customers'].includes(userPrefix)
  }
  if (prefix === 'customers') {
    return userPrefix === 'customers'
  }
  return prefix === 'internal'
}

const _checkAccess = ({ userAccess, access }) => {
  return access === -1 ||
    (userAccess !== -1 && userAccess <= access)
}

const _checkClient = ({ userClient, client }) => {
  return client === -1 ||
    (userClient !== -1 && userClient.every((c) => client.includes(c)))
}

const _checkUserInfo = ({ userInfo, prefix, api_access }) => {
  // intended userInfo
  const {
    api_access: userAccess={},
    prefix: userPrefix,
  } = userInfo
  // prefix check
  if (!_checkPrefix({ userPrefix, prefix })) {
    const error = new Error('Prefix check failed')
    error.statusCode = 403
    error.logLevel = 'WARNING'
    throw error
  }
  // numerical access check
  for (const r of RESOURCES) {
    if (!_checkAccess({
      userAccess: userAccess[r] || 0, access: api_access[r] || 0
    })) {
      const error = new Error(`Access (${r}) check failed`)
      error.statusCode = 403
      error.logLevel = 'WARNING'
      throw error
    }
  }
  // client (wl, customers) check
  for (const c of ['wl', 'customers']) {
    if (!_checkClient({
      userClient: userAccess[c] || [], client: api_access[c] || []
    })) {
      const error = new Error(`Client (${c}) check failed`)
      error.statusCode = 403
      error.logLevel = 'WARNING'
      throw error
    }
  }
}

// create/edit a user
const editUser = ({
  userInfo,
  prefix,
  api_access,
  product='atom',
  newUser=false,
}) => {
  _checkUserInfo({ userInfo, prefix, api_access })
  const {
    email,
    api_access: _access={},
  } = userInfo
  const {
    wl=[],
    customers=[],
    read=0,
    write=0,
  } = _access
  const user = {
    email,
    prefix,
    [product]: { read, write },
    client: { wl, customers },
  }
  if (newUser) {
    return insertUser(user)
  }
  return updateUser(user)
}

// deactivate/delete a user
const removeUser = ({ userInfo, prefix, api_access, hard=false }) => {
  _checkUserInfo({ userInfo, prefix, api_access })
  const { email } = userInfo
  return deleteUser({ email, hard })
}

module.exports = {
  getUsers,
  getUser,
  editUser,
  removeUser,
}
