/*********************************************************
* DO NOT modify this file directly on AWS Lambda console *
*********************************************************/
const url = require('url')

const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const uuidv4 = require('uuid/v4')
const { DateTime } = require('luxon')
const nodemailer = require('nodemailer')
const AWS = require('aws-sdk')
const MongoClient = require('mongodb').MongoClient
const { isEqual } = require('lodash')

const JWT_SECRET = process.env.JWT_SECRET
const JWT_TTL = parseInt(process.env.JWT_TTL) || (90 * 24 * 60 * 60) // in s
const MONGO_URI = process.env.MONGO_URI
const MONGO_USER_DB = process.env.MONGO_USER_DB || 'eqreporting'
const MONGO_USER_COLL = process.env.MONGO_USER_COLL || 'equsers'
const OTP_TTL = parseInt(process.env.OTP_TTL) || (5 * 60 * 1000) // in ms

const CORS_HEADERS = () => {
  return {
    // Required for CORS support to work
    'Access-Control-Allow-Origin' : '*',
    // Required for cookies, authorization headers with HTTPS
    'Access-Control-Allow-Credentials' : true
  }
}

// one time passcode generator, by default 6-digit
// NOTE: at most 16-digit (or up to Math.random() implementation)
const getOtp = (digit = 6) => String(Math.random()).substring(2, digit + 2)

// get user from datastore and set otp
const loginUser = ({ user, otp }) => {
  let _client
  // find and update user with bcrypt'ed otp
  return MongoClient.connect(MONGO_URI).then((client) => {
    _client = client
    return bcrypt.hash(otp, 10)
  }).then((hash) => {
    return _client.db(MONGO_USER_DB).collection(MONGO_USER_COLL).findOneAndUpdate({
      email: user
    }, {
      $set: {
        otp: {
          hash,
          ttl: DateTime.utc().plus(OTP_TTL).valueOf()
        }
      }
    }, {
      projection: {
        _id: 0,
        email: 1,
        'otp.ttl': 1
      },
      maxTimeMS: 15 * 1000, // give it half of the 30 sec total limit
      returnOriginal: false
    })
  }).then((r) => {
    _client.close()
    const email = r.value.email
    const _otp = r.value.otp || {}
    _otp.ttl = DateTime.fromMillis(
      _otp.ttl,
      { zone: 'utc' }
    ).toLocaleString(DateTime.DATETIME_FULL_WITH_SECONDS)
    _otp.passcode = otp // assign plaintext value
    return {
      email,
      otp: _otp
    }
  }).catch((err) => {
    try {
      _client.close()
    } catch(err) {
      // ignore this
    }
    throw err
  })
}

// send email with otp
const sendOtp = ({ userInfo, redirect }) => {
  const otp = userInfo.otp.passcode // the plaintext version is only available from loginUser()
  const ttl = userInfo.otp.ttl
  // use `url` to parse original redirect
  const link = url.parse(redirect, true)
  link.query = link.query || {} // force link.query to be available
  Object.assign(link.query, { // add magic link query string params
    user: userInfo.email,
    otp
  })
  link.search = undefined // force search to be undfined to elevate link.query
  const magicLink = url.format(link) // reconstruct into magicLink
  const message = {
    from: 'dev@eqworks.com',
    to: userInfo.email,
    subject: 'EQ Works Login Passcode',
    text: `
      Welcome to EQ Works\n
      Please login with the Magic Link ${magicLink}\n
      Or manually enter: ${otp}\n
      You have until ${ttl} before it expires, and all previous passcodes are now invalid
    `,
    html: `
      <h3>Welcome to EQ Works</h3>
      <p>Login with the <a href="${magicLink}">Magic Link</a></p>
      <p>Or manually enter: <strong>${otp}</strong></p>
      <p>You have until <strong>${ttl}</strong> before it expires, and all previous passcodes are now invalid</p>
    `
  }
  return nodemailer.createTransport({ SES: new AWS.SES() }).sendMail(message)
}

// get user from datastore and verify otp
const verifyUser = ({ user, otp }) => {
  let _client
  let _userInfo
  let _col
  // find user with otp hash
  return MongoClient.connect(MONGO_URI).then((client) => {
    _client = client
    _col = _client.db(MONGO_USER_DB).collection(MONGO_USER_COLL)
    return _col.findOne({
      email: user
    }, {
      projection: {
        _id: 0,
        email: 1,
        otp: 1,
        api_access: 1,
        jwt_uuid: 1
      },
      maxTimeMS: 15 * 1000 // give it half of the 30 sec total limit
    })
  }).then((doc) => {
    // carve out email and api_access for later signing
    const { email, api_access, jwt_uuid } = doc
    _userInfo = { email, api_access, jwt_uuid }
    // otp verification
    const _otp = doc.otp || {}
    if (DateTime.utc().valueOf() >= _otp.ttl) {
      const err = new Error('Passcode has expired')
      err.statusCode = 403
      throw err
    }
    return bcrypt.compare(otp, _otp.hash || '')
  }).then((res) => {
    if (!res) {
      const err = new Error('Invalid passcode')
      err.statusCode = 403
      throw err
    }
    // unset otp
    const updates = {
      $unset: { otp: '' }
    }
    // set `jwt_uuid` if not set already
    if (!_userInfo.jwt_uuid) {
      _userInfo.jwt_uuid = uuidv4()
      updates['$set'] = {
        jwt_uuid: _userInfo.jwt_uuid
      }
    }
    // update the user with desired updates
    return _col.updateOne({
      email: user
    }, updates)
  }).then(() => {
    _client.close()
    // passcode checked, generate jwt and return
    return {
      token: jwt.sign(_userInfo, JWT_SECRET, { expiresIn: JWT_TTL })
    }
  }).catch((err) => {
    try {
      _client.close()
    } catch(err) {
      // ignore this
    }
    throw err
  })
}

// get user from datastore and confirm with supplied JWT
const confirmUser = (payload) => {
  let _client
  // find user with otp hash
  return MongoClient.connect(MONGO_URI).then((client) => {
    _client = client
    return _client.db(MONGO_USER_DB).collection(MONGO_USER_COLL).findOne({
      email: payload.email
    }, {
      projection: {
        _id: 0,
        email: 1,
        api_access: 1,
        jwt_uuid: 1
      },
      maxTimeMS: 15 * 1000 // give it half of the 30 sec total limit
    })
  }).then((doc) => {
    _client.close()
    for (const key of ['email', 'jwt_uuid']) {
      if (doc[key] !== payload[key]) {
        return false
      }
    }
    for (const key of Object.keys(doc.api_access)) {
      if (!isEqual(doc.api_access[key], payload.api_access[key])) {
        return false
      }
    }
    return true
  }).catch((err) => {
    try {
      _client.close()
    } catch(err) {
      // ignore this
    }
    throw err
  })
}

// HTTP GET /login
module.exports.login = (event, context, callback) => {
  // get various info needed from event (API Gateway - LAMBDA PROXY)
  // `user` is in the form of an email address
  // `redirect` is used for signaling requesting application
  // which URI to redirect to after /verify successfully
  let { user, redirect } = event.queryStringParameters || {}
  if (!user) {
    return callback(null, {
      statusCode: 400,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: 'Missing `user` in query string parameters'
      })
    })
  }
  // origin and stage are used for composing the verify link
  const headers = event.headers || {}
  const origin = `${headers['X-Forwarded-Proto']}://${headers.Host}`
  const { stage } = event.requestContext || {}
  // grab an otp
  const otp = getOtp()
  // get user and set its otp
  return loginUser({ user, otp }).then((userInfo) => {
    // default redirect back to keywarden for manual verification
    redirect = redirect || `${origin}/${stage}/verify`
    return sendOtp({ userInfo, redirect })
  }).then((info) => {
    console.log(info)
    return callback(null, {
      statusCode: 200,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: `Login passcode has been sent to ${user} through email`,
        user
      })
    })
  }).catch((err) => {
    console.error(err.stack || err)
    return callback(null, {
      statusCode: err.statusCode || 500,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: `Unable to login user ${user} - ${err.message || 'server error'}`,
        user
      })
    })
  })
}

// HTTP GET /verify
module.exports.verify = (event, context, callback) => {
  const { user, otp } = event.queryStringParameters || {}
  if (!user) {
    return callback(null, {
      statusCode: 400,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: 'Missing `user` in query string parameters'
      })
    })
  }
  if (!otp) {
    return callback(null, {
      statusCode: 400,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: 'Missing `otp` in query string parameters'
      })
    })
  }
  verifyUser({ user, otp }).then((res) => {
    const { token } = res
    return callback(null, {
      statusCode: 200,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: `User ${user} verified, please store and use the attached token responsibly`,
        user,
        token // this contains { email, api_access }
      })
    })
  }).catch((err) => {
    console.error(err.stack || err)
    return callback(null, {
      statusCode: err.statusCode || 500,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: `Unable to verify user ${user} - ${err.message || 'server error'}`
      })
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
    userInfo = jwt.verify(token, JWT_SECRET)
  } catch(err) {
    return callback(null, {
      statusCode: 403,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: `Invalid JWT: ${token}`
      })
    })
  }
  // payload fields existence check
  const requiredKeys = ['email', 'api_access', 'jwt_uuid']
  if (!requiredKeys.every(k => k in userInfo)) {
    return callback(null, {
      statusCode: 403,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: 'JWT missing required fields in payload'
      })
    })
  }
  // light confirmation requested, no need to check user integrity against db
  if (~['1', 'true'].indexOf((light || '').toLowerCase())) {
    return callback(null, {
      statusCode: 200,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: `Token confirmed for user: ${userInfo.email} (light)`
      })
    })
  }
  // payload integrity check against db
  confirmUser(userInfo).then((result) => {
    if (!result) {
      return callback(null, {
        statusCode: 403,
        headers: CORS_HEADERS(),
        body: JSON.stringify({
          message: `Token payload no longer valid for user: ${userInfo.email}`
        })
      })
    } else {
      return callback(null, {
        statusCode: 200,
        headers: CORS_HEADERS(),
        body: JSON.stringify({
          message: `Token confirmed for user: ${userInfo.email}`
        })
      })
    }
  })
}
