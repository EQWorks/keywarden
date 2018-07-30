const { corsHeaders } = require('./modules/cors.js')
const {
  getOtp,
  loginUser,
  sendOtp,
  signJwt,
  verifyOtp,
  verifyJwt,
  confirmUser,
} = require('./modules/auth.js')

// HTTP GET /
module.exports.index = (event, context, callback) => {
  const { KEYWARDEN_VER, STAGE } = process.env
  return callback(null, {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({
      STAGE,
      KEYWARDEN_VER,
    })
  })
}

// HTTP GET /login
module.exports.login = (event, context, callback) => {
  // get various info needed from event (API Gateway - LAMBDA PROXY)
  // `user` is in the form of an email address
  // `redirect` is used for signaling requesting application
  // which URI to redirect to after /verify successfully
  const { user, redirect, zone } = event.queryStringParameters || {}
  if (!user) {
    const message = 'Missing `user` in query string parameters'
    console.log(`[WARNING] ${message}`)
    return callback(null, {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ message })
    })
  }
  // origin and stage are used for composing the verify link
  const headers = event.headers || {}
  const origin = `${headers['X-Forwarded-Proto']}://${headers.Host}`
  const { stage } = event.requestContext || {}
  const otp = getOtp() // grab an otp
  return loginUser({ // get user and set its otp
    user, otp,
    zone: decodeURIComponent(zone)
  }).then((userInfo) => {
    return sendOtp({ // send OTP along with redirect (magic) link for /verify
      userInfo,
      redirect: decodeURIComponent(redirect || `${origin}/${stage}/verify`)
    })
  }).then((info) => {
    const message = `Login passcode has been sent to ${user} through email`
    console.log(`[INFO] ${message}`, info)
    return callback(null, {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ message, user })
    })
  }).catch((err) => {
    const message = `Unable to login user ${user} - ${err.message || 'server error'}`
    console.error(`[ERROR] ${message}`, err.stack || err)
    return callback(null, {
      statusCode: err.statusCode || 500,
      headers: corsHeaders(),
      body: JSON.stringify({ message, user })
    })
  })
}

// HTTP GET /verify
module.exports.verify = (event, context, callback) => {
  const { user, otp } = event.queryStringParameters || {}
  if (!user) {
    const message = 'Missing `user` in query string parameters'
    console.log(`[WARNING] ${message}`)
    return callback(null, {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ message })
    })
  }
  if (!otp) {
    const message = 'Missing `user` in query string parameters'
    console.log(`[WARNING] ${message}`)
    return callback(null, {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ message })
    })
  }
  verifyOtp({ user, otp }).then((res) => {
    const { token } = res
    const message = `User ${user} verified, please store and use the attached token responsibly`
    console.log(`[INFO] ${message}`)
    return callback(null, {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ message, user, token })
    })
  }).catch((err) => {
    const message = `Unable to verify user ${user} - ${err.message || 'server error'}`
    console.error(`[ERROR] ${message}`, err.stack || err)
    return callback(null, {
      statusCode: err.statusCode || 500,
      headers: corsHeaders(),
      body: JSON.stringify({ message })
    })
  })
}

// HTTP GET /confirm
module.exports.confirm = (event, context, callback) => {
  // light version of confirming user JWT validity and integrity
  const headers = event.headers || {}
  const token = headers['eq-api-jwt']
  const { light } = event.queryStringParameters || {}
  let userInfo
  // preliminary jwt verify
  try {
    userInfo = verifyJwt(token)
  } catch(err) {
    const message = `Invalid JWT: ${token}`
    console.log(`[WARNING] ${message}`)
    return callback(null, {
      statusCode: 403,
      headers: corsHeaders(),
      body: JSON.stringify({ message })
    })
  }
  // payload fields existence check
  const requiredKeys = ['email', 'api_access', 'jwt_uuid']
  if (!requiredKeys.every(k => k in userInfo)) {
    const message = 'JWT missing required fields in payload'
    console.log(`[WARNING] ${message}`, userInfo)
    return callback(null, {
      statusCode: 403,
      headers: corsHeaders(),
      body: JSON.stringify({ message })
    })
  }
  // light confirmation requested, no need to check user integrity against db
  if (~['1', 'true'].indexOf((light || '').toLowerCase())) {
    const message = `Token confirmed for user: ${userInfo.email} (light)`
    console.log(`[INFO] ${message}`)
    return callback(null, {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ message })
    })
  }
  // payload integrity check against db
  confirmUser(userInfo).then((result) => {
    if (!result) {
      const message = `Token payload no longer valid for user: ${userInfo.email}`
      console.log(`[WARNING] ${message}`)
      return callback(null, {
        statusCode: 403,
        headers: corsHeaders(),
        body: JSON.stringify({ message })
      })
    } else {
      const message = `Token confirmed for user: ${userInfo.email}`
      console.log(`[INFO] ${message}`)
      return callback(null, {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ message })
      })
    }
  })
}

// HTTP GET /refresh
module.exports.refresh = (event, context, callback) => {
  const headers = event.headers || {}
  const token = headers['eq-api-jwt']
  let userInfo
  // preliminary jwt verify
  try {
    userInfo = verifyJwt(token)
  } catch(err) {
    const message = `Invalid JWT: ${token}`
    console.log(`[WARNING] ${message}`)
    return callback(null, {
      statusCode: 403,
      headers: corsHeaders(),
      body: JSON.stringify({ message })
    })
  }
  // payload fields existence check
  const requiredKeys = ['email', 'api_access', 'jwt_uuid']
  if (!requiredKeys.every(k => k in userInfo)) {
    const message = 'JWT missing required fields in payload'
    console.log(`[WARNING] ${message}`, userInfo)
    return callback(null, {
      statusCode: 403,
      headers: corsHeaders(),
      body: JSON.stringify({ message })
    })
  }
  // payload integrity check against db
  confirmUser(userInfo).then((result) => {
    if (!result) {
      const message = `Token payload no longer valid for user: ${userInfo.email}`
      console.log(`[WARNING] ${message}`)
      return callback(null, {
        statusCode: 403,
        headers: corsHeaders(),
        body: JSON.stringify({ message })
      })
    } else {
      const message = `Token refreshed for user: ${userInfo.email}`
      console.log(`[INFO] ${message}`)
      const { email, api_access, jwt_uuid } = userInfo
      const token = signJwt({ email, api_access, jwt_uuid })
      return callback(null, {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ message, token })
      })
    }
  })
}
