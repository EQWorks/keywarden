const { PREFIX_WL, PREFIX_CUSTOMERS, PREFIX_INTERNAL, PREFIX_DEV, PREFIX_TESTER } = require('../constants')
const { AuthorizationError } = require('./errors')

const checkPolicies = ({ targetPolicies = [], policies = [] }) => {
  if (!targetPolicies.length) {
    return
  }
  const pass = policies.some((p) => p.match(targetPolicies))
  if (!pass) {
    throw new AuthorizationError('Policies check failed')
  }
}

const checkAccess = ({ targetAccess, access, name }) => {
  const pass = access === -1 || (targetAccess !== -1 && targetAccess <= access)
  if (pass) {
    return
  }
  throw new AuthorizationError(`Access: ${name} check failed`)
}

const checkPrefix = ({ targetPrefix, prefix }) => {
  // for product compat reason, prefix can be optional
  if (!targetPrefix) {
    return
  }
  let pass
  switch(prefix) {
  case PREFIX_WL:
    pass = [PREFIX_WL, PREFIX_CUSTOMERS].includes(targetPrefix)
    break
  case PREFIX_CUSTOMERS:
    pass = targetPrefix === PREFIX_CUSTOMERS
    break
  case PREFIX_INTERNAL:
    pass = [PREFIX_WL, PREFIX_CUSTOMERS, PREFIX_INTERNAL, PREFIX_TESTER].includes(targetPrefix)
    break
  case PREFIX_DEV:
    pass = true
    break
  default:
    pass = false
  }
  if (!pass) {
    throw new AuthorizationError('Prefix check failed')
  }
}

const checkClient = ({ targetClient, client, name }) => {
  const pass =
    client === -1 ||
    (targetClient !== -1 && targetClient.every(c => client.includes(c)))
  if (pass) {
    return
  }
  throw new AuthorizationError(`Client: ${name} check failed`)
}

const fullCheck = ({ target, me }) => {
  const {
    prefix: targetPrefix,
    access: targetAccess,
    policies: targetPolicies,
    clients: targetClients,
  } = target
  const { prefix, access, policies, clients } = me
  // prefix check
  checkPrefix({ targetPrefix, prefix })
  // numerical access check
  for (const name of Object.keys(targetAccess)) {
    checkAccess({
      targetAccess: parseInt(targetAccess[name]) || 0,
      access: parseInt(access[name]) || 0,
      name,
    })
  }
  // check policies
  if (access.version) { // for backward compatibility
    checkPolicies({ targetPolicies, policies })
  }
  // check clients
  for (const name of Object.keys(targetClients)) {
    checkClient({
      targetClient: targetClients[name] || [],
      client: clients[name] || [],
      name,
    })
  }
}

module.exports = {
  checkPolicies,
  checkAccess,
  checkPrefix,
  checkClient,
  fullCheck,
}
