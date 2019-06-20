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
const { fullCheck } = require('./access')

const _prepareConditions = ({ prefix, api_access, product = 'atom' }) => {
  // derive select conditions based on prefix and api_access
  const { wl = [], customers = [], read = 0, write = 0 } = api_access
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
      conditions.push(
        `client->'customers' <@ '${JSON.stringify(customers)}'::jsonb`
      )
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
const getUsers = ({ prefix, api_access, product = 'atom' }) => {
  const conditions = _prepareConditions({ prefix, api_access, product })
  const selects = ['email', 'prefix', 'client', 'info', product]
  return listUsers({ selects, conditions })
}

// get a user by email that the given user (email) has access to
const getUser = ({ email, prefix, api_access, product = 'atom' }) => {
  const conditions = _prepareConditions({ prefix, api_access, product })
  const selects = ['email', 'prefix', 'client', 'info', product]
  return selectUser({ email, selects, conditions })
}

const _prepareUser = ({ userInfo, prefix, product }) => {
  // extract user info
  const { email, api_access: _access = {}, prefix: _prefix = prefix } = userInfo
  // further extraction with safeguards
  const { wl = [], customers = [], read = 0, write = 0 } = _access
  // db schema compliant user object (field = column)
  return {
    email,
    prefix: _prefix,
    [product]: { read, write },
    client: { wl, customers },
  }
}

const _canManage = ({ userInfo, prefix, api_access }) => {
  // target userInfo
  const {
    api_access: {
      wl: targetWL,
      customers: targetCustomers,
      ...targetAccess
    } = {},
    prefix: targetPrefix,
  } = userInfo
  // requesting user
  const { wl, customers, ...access } = api_access
  fullCheck({
    target: {
      prefix: targetPrefix,
      access: targetAccess,
      clients: { wl: targetWL, customers: targetCustomers },
    },
    me: {
      prefix,
      access,
      clients: { wl, customers },
    },
  })
}

// create a user
const createUser = ({ userInfo, prefix, api_access, product = 'atom' }) => {
  _canManage({ userInfo, prefix, api_access })
  const user = _prepareUser({ userInfo, prefix, product })
  return insertUser(user)
}

const editUser = ({ userInfo, prefix, api_access, product = 'atom' }) => {
  _canManage({ userInfo, prefix, api_access })
  const user = _prepareUser({ userInfo, prefix, product })
  return updateUser(user)
}

// delete a user
const removeUser = ({ userInfo, prefix, api_access }) => {
  _canManage({ userInfo, prefix, api_access })
  return deleteUser(userInfo.email)
}

// deactivate a user (special case editUser)
const deactivateUser = ({ userInfo, prefix, api_access }) => {
  _canManage({ userInfo, prefix, api_access })
  const { email } = userInfo
  return updateUser({ email, jwt_uuid: null, active: 0 })
}

// activate a user (special case editUser)
const activateUser = ({ userInfo, prefix, api_access }) => {
  _canManage({ userInfo, prefix, api_access })
  const { email } = userInfo
  return updateUser({ email, active: 1 })
}

module.exports = {
  getUsers,
  getUser,
  createUser,
  editUser,
  removeUser,
  deactivateUser,
  activateUser,
}
