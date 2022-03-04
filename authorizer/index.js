const { verifyJWT, confirmUser } = require('../modules/auth')
const { PREFIX_MOBILE_SDK, PREFIX_PUBLIC, PRODUCT_ATOM } = require('../constants')
const { APIError, AuthorizationError } = require('../modules/errors')


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

// TODO: factor out the common logic with `middleware.confirmed`
const getUserAccess = async (token) => {
  // preliminary jwt verify
  const access = verifyJWT(token)

  // set product to atom if missing from jwt or falsy for backward compatibility
  access.product = access.product || PRODUCT_ATOM

  // payload fields existence check
  const fields = ['email', 'api_access', 'jwt_uuid']
  if (!fields.every(k => k in access)) {
    throw new AuthorizationError('JWT missing required fields in payload')
  }

  // force light mode if user.prefix is PREFIX_MOBILE_SDK
  if (access.prefix === PREFIX_MOBILE_SDK) {
    return access
  }
  // confirm against DB user data and return the DB version (for v1+ `access` system)
  return confirmUser(access)
}

// generates a generic access object with public permissions
const genPublicAccess = (email) => ({
  email,
  prefix: PREFIX_PUBLIC,
  // TODO: increment `version` and remove other fields when v1 `access` is universal
  api_access: {
    version: 0,
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
    throw new APIError({ message: 'Not an API resource', statusCode: 400 })
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
