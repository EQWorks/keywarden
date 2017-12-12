/*********************************************************
* DO NOT modify this file directly on AWS Lambda console *
*********************************************************/
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const uuidv4 = require('uuid/v4')
const { DateTime } = require('luxon')
const nodemailer = require('nodemailer')
const AWS = require('aws-sdk')
const MongoClient = require('mongodb').MongoClient

const JWT_SECRET = process.env.JWT_SECRET
const MONGO_URI = process.env.MONGO_URI
const MONGO_USER_DB = process.env.MONGO_USER_DB || 'eqreporting'
const MONGO_USER_COLL = process.env.MONGO_USER_COLL || 'equsers'
const OTP_TTL = parseInt(process.env.OTP_TTL) || (5 * 60 * 1000) // in ms

// one time passcode generator, by default 6-digit
// NOTE: at most 16-digit (or up to Math.random() implementation)
const getOtp = (digit = 6) => String(Math.random()).substring(2, digit + 2)

// get user from datastore and set otp
const loginUser = ({ user, otp, redirect }) => {
  redirect = redirect || null
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
          ttl: DateTime.utc().plus(OTP_TTL).valueOf(),
          redirect
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
const sendOtp = ({ userInfo, origin, stage }) => {
  const otp = userInfo.otp.passcode // the plaintext version is only available from loginUser()
  const ttl = userInfo.otp.ttl
  const magicLink = `${origin}/${stage}/verify?user=${userInfo.email}&otp=${otp}`
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
  let _redirect
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
    _redirect = _otp.redirect
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
      token: jwt.sign(_userInfo, JWT_SECRET),
      redirect: _redirect
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

// HTTP GET /login
module.exports.login = (event, context, callback) => {
  // get various info needed from event (API Gateway - LAMBDA PROXY)
  // `user` is in the form of an email address
  // `redirect` is used for signaling requesting application
  // which URI to redirect to after /verify successfully
  const { user, redirect } = event.queryStringParameters || {}
  if (!user) {
    return callback(null, {
      statusCode: 400,
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
  return loginUser({ user, otp, redirect }).then((userInfo) => {
    return sendOtp({ userInfo, origin, stage })
  }).then((info) => {
    console.log(info)
    return callback(null, {
      statusCode: 200,
      body: JSON.stringify({
        message: `Login passcode has been sent to ${user} through email`,
        user
      })
    })
  }).catch((err) => {
    console.error(err.stack || err)
    return callback(null, {
      statusCode: err.statusCode || 500,
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
      body: JSON.stringify({
        message: 'Missing `user` in query string parameters'
      })
    })
  }
  if (!otp) {
    return callback(null, {
      statusCode: 400,
      body: JSON.stringify({
        message: 'Missing `otp` in query string parameters'
      })
    })
  }
  verifyUser({ user, otp }).then((res) => {
    const { token, redirect } = res
    return callback(null, {
      statusCode: 200,
      body: JSON.stringify({
        message: `User ${user} verified, please store and use the attached token responsibly`,
        user,
        token, // this contains { email, api_access }
        redirect
      })
    })
  }).catch((err) => {
    console.error(err.stack || err)
    return callback(null, {
      statusCode: err.statusCode || 500,
      body: JSON.stringify({
        message: `Unable to verify user ${user} - ${err.message || 'server error'}`
      })
    })
  })
}
