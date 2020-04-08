const { AuthorizationError } = require('./errors')

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
  if (prefix === 'wl') {
    pass = ['wl', 'customers'].includes(targetPrefix)
  } else if (prefix === 'customers') {
    pass = targetPrefix === 'customers'
  } else if (prefix === 'internal') {
    pass = ['wl', 'customers', 'internal'].includes(targetPrefix)
  } else {
    pass = prefix === 'dev'
  }
  if (pass) {
    return
  }
  throw new AuthorizationError('Prefix check failed')
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
    clients: targetClients,
  } = target
  const { prefix, access, clients } = me
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
  checkAccess,
  checkPrefix,
  checkClient,
  fullCheck,
}
