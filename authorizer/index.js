const { verifyJWT, confirmUser } = require('../modules/auth')

// Helper function to generate an IAM policy
const generateAuthPolicy = (resource, proceed = false, access = {}) => {
  return {
    principalId: access.jwt_uuid || 'Unknown',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{
        Action: 'execute-api:Invoke',
        Effect: proceed ? 'Allow' : 'Deny',
        Resource: resource,
      }]
    },
    context: { access: JSON.stringify(access) }
  }
}

// throws if faillure
const getUserAccess = async (token) => {
  // preliminary jwt verify
  const access = verifyJWT(token)

  // set product to atom if missing from jwt or falsy for backward compatibility
  access.product = access.product || 'atom'

  // payload fields existence check
  if (['email', 'api_access', 'jwt_uuid'].some(field => !(field in access))) {
    throw Error('JWT missing required fields in payload')
  }

  // check that accesses and uuid have not vhangd for user
  await confirmUser(access)

  return access
}

// generates a generic access object with public permissions
const genPublicAccess = (id) => ({
  email: id,
  prefix: 'public',
  api_access: {
    wl: [],
    customers: [],
    read : 0,
    write : 0,
  }
})

// confirms that token matches 'public' token pattern
const isPublicToken = (token) => token.indexOf('public') !== -1

// returns the stage level api resource from a method ARN
const getAPIRootResource = (resource) => {
  const matches = resource.match(/^arn:aws:execute-api:[^/]+\/[^/]+\//)
  if (!matches || matches.length !== 1) {
    throw Error('Not an API resource')
  }
  return `${matches[0]}*`
}

module.exports.handler = async ({ authorizationToken: token, methodArn } = {}) => {
  try {
    const rootResource = getAPIRootResource(methodArn)

    // let public traffic through
    if (isPublicToken(token)) {
      const publicAccess = genPublicAccess(token)
      return generateAuthPolicy(rootResource, true, publicAccess)
    }

    const userAccess = await getUserAccess(token)
    return generateAuthPolicy(rootResource, true, userAccess)

  } catch (err) {
    return generateAuthPolicy(methodArn)
  }
}
