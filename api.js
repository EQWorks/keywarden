/*********************************************************
* DO NOT modify this file directly on AWS Lambda console *
*********************************************************/
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const { DateTime } = require('luxon')
const nodemailer = require('nodemailer')
const AWS = require('aws-sdk')
const MongoClient = require('mongodb').MongoClient

const JWT_SECRET = process.env.JWT_SECRET
const MONGO_URI = process.env.MONGO_URI
const MONGO_USER_COLL = process.env.MONGO_USER_COLL
const OTP_TTL = process.env.OTP_TTL || (5 * 60 * 1000) // in ms

// one time passcode generator, by default 6-digit
// NOTE: at most 16-digit (or up to Math.random() implementation)
const getOtp = (digit = 6) => String(Math.random()).substring(2, digit + 2)

// get user from datastore and set otp
const loginUser = ({ user, otp, redirect }) => {
  redirect = redirect || null
  let _db
  // find and update user with bcrypt'ed otp
  return MongoClient.connect(MONGO_URI).then((db) => {
    _db = db
    return bcrypt.hash(otp, 10)
  }).then((hash) => {
    return _db.collection(MONGO_USER_COLL).findOneAndUpdate({
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
  }).then((userInfo) => {
    _db.close()
    userInfo.otp.ttl = DateTime.fromMillis(
      userInfo.otp.ttl,
      { zone: 'utc' }
    ).toLocaleString(DateTime.DATETIME_FULL_WITH_SECONDS)
    userInfo.otp.hash = otp
    return userInfo
  }).catch((err) => {
    _db.close()
    throw err
  })
}

// send email with otp
const sendOtp = ({ userInfo, origin, stage }) => {
  const otp = userInfo.otp.hash
  const ttl = userInfo.otp.ttl
  const transporter = nodemailer.createTransport({ SES: new AWS.SES() })
  const magicLink = `${origin}/${stage}/verify?user=${userInfo.email}&otp=${otp}`
  return transporter.sendMail({
    from: 'dev@eqworks.com',
    to: userInfo.email,
    subject: 'EQ Works Login Passcode',
    text: `
      Welcome to EQ Works\n
      Please login with the Magic Link ${magicLink}\n
      Or manually enter: ${otp}\n
      You have until ${ttl} before it expires
    `,
    html: `
      <h3>Welcome to EQ Works</h3>
      <p>Login with the <a href="${magicLink}">Magic Link</a></p>
      <p>Or manually enter: <strong>${otp}</strong></p>
      <p>You have until <strong>${ttl}</strong> before it expires</p>
    `
  })
}

// get user from datastore and verify otp
const verifyUser = ({ user, otp }) => {
  let _db
  let _userInfo
  let _redirect
  // find user with otp hash
  return MongoClient.connect(MONGO_URI).then((db) => {
    _db = db
    return db.collection(MONGO_USER_COLL).findOne({
      email: user
    }, {
      fields: {
        _id: 0,
        email: 1,
        otp: 1,
        api_access: 1
      },
      maxTimeMS: 15 * 1000 // give it half of the 30 sec total limit
    })
  }).then((userInfo) => {
    _db.close()
    // carve out email and api_access for later signing
    const { email, api_access } = userInfo
    _userInfo = { email, api_access }
    // otp verification
    userInfo.otp = userInfo.otp || {}
    _redirect = userInfo.otp.redirect
    if (DateTime.utc().valueOf() < userInfo.otp.ttl) {
      const err = new Error('Passcode has expired')
      err.statusCode = 403
      throw err
    }
    return bcrypt.compare(otp, userInfo.otp.hash)
  }).then((res) => {
    if (!res) {
      const err = new Error('Invalid passcode')
      err.statusCode = 403
      throw err
    }
    // passcode checked, generate jwt and return
    return {
      token: jwt.sign(_userInfo, JWT_SECRET),
      redirect: _redirect
    }
  }).catch((err) => {
    _db.close()
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
  // origin and stage are used for composing the verify link
  const { origin } = event.headers || {}
  const { stage } = event.requestContext || {}
  // grab an otp
  const otp = getOtp()
  // get user and set its otp
  return loginUser({ user, otp, redirect }).then((userInfo) => {
    return sendOtp({ userInfo, origin, stage, redirect })
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
