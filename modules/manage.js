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
const { fullCheck, checkPolicies } = require('./access')
const { APIError } = require('./errors')
const {
  PREFIX_WL,
  PREFIX_CUSTOMERS,
  PRODUCT_ATOM,
  USER_POLICIES_READ,
  USER_POLICIES_WRITE,
} = require('../constants')


const _prepareConditions = ({ prefix, api_access, product = PRODUCT_ATOM }) => {
  // derive select conditions based on prefix and api_access
  const { wl = [], customers = [], read = 0, write = 0 } = api_access
  const conditions = []
  if (prefix === PREFIX_WL) {
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
  } else if (prefix === PREFIX_CUSTOMERS) {
    if (customers !== -1) {
      conditions.push(
        `client->'customers' <@ '${JSON.stringify(customers)}'::jsonb`,
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

const BASE_SELECTS = ['email', 'prefix', 'client', 'info', 'access', 'active']
// list users that the given user (email) has access to
const getUsers = ({ prefix, api_access, product = PRODUCT_ATOM }) => {
  if (api_access.version) {
    checkPolicies({ targetPolicies: [USER_POLICIES_READ], policies: api_access.policies })
  }
  const conditions = _prepareConditions({ prefix, api_access, product })
  const selects = [...BASE_SELECTS, product]
  return listUsers({ selects, conditions })
}

// get a user by email that the given user (email) has access to
const getUser = async ({ email, prefix, api_access, product = PRODUCT_ATOM }) => {
  const conditions = _prepareConditions({ prefix, api_access, product })
  const selects = [...BASE_SELECTS, product]
  const user = await selectUser({ email, selects, conditions })

  if (!user) {
    throw new APIError({
      message: `User ${email} not found`,
      statusCode: 404,
    })
  }

  return user
}

const _canManage = ({ userInfo, prefix, api_access, product, policies: targetPolicies = [] }) => {
  // target userInfo
  const {
    client: { wl: targetWL, customers: targetCustomers },
    prefix: targetPrefix,
  } = userInfo
  let targetAccess
  if (userInfo.access && userInfo.access.version) {
    // the first element of the policies array is the product policy - '<product>:<read>:<write>' (ex: 'atom:-1:-1')
    const [, read, write] = userInfo.access.policies[0].split(':')
    targetAccess = { read, write }
  }else{
    targetAccess = userInfo[product]
  }

  // requesting user
  const { wl, customers, policies, ...access } = api_access
  fullCheck({
    target: {
      prefix: targetPrefix,
      access: targetAccess,
      policies: targetPolicies,
      clients: { wl: targetWL, customers: targetCustomers },
    },
    me: {
      prefix,
      access,
      policies,
      clients: { wl, customers },
    },
  })
}

// create a user
const createUser = ({ userInfo, prefix, api_access, product = PRODUCT_ATOM }) => {
  _canManage({ userInfo, prefix, api_access, product, policies: [USER_POLICIES_WRITE] })
  return insertUser(userInfo)
}

const editUser = ({ userInfo, prefix, api_access, product = PRODUCT_ATOM }) => {
  _canManage({ userInfo, prefix, api_access, product, policies: [USER_POLICIES_WRITE] })
  return updateUser(userInfo)
}

// delete a user
const removeUser = ({ userInfo, prefix, api_access }) => {
  _canManage({ userInfo, prefix, api_access, policies: [USER_POLICIES_WRITE] })
  return deleteUser(userInfo.email)
}

// deactivate a user (special case editUser)
const deactivateUser = ({ userInfo, prefix, api_access }) => {
  _canManage({ userInfo, prefix, api_access, policies: [USER_POLICIES_WRITE] })
  const { email } = userInfo
  return updateUser({ email, jwt_uuid: null, active: 0 })
}

// activate a user (special case editUser)
const activateUser = ({ userInfo, prefix, api_access }) => {
  _canManage({ userInfo, prefix, api_access, policies: [USER_POLICIES_WRITE] })
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
