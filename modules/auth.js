const url = require('url')

const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const uuidv4 = require('uuid/v4')
const moment = require('moment-timezone')
const nodemailer = require('nodemailer')
const AWS = require('aws-sdk')
const MongoClient = require('mongodb').MongoClient
const { isEqual } = require('lodash')

const { magicLinkEmail } = require('./email.js')

const JWT_SECRET = process.env.JWT_SECRET
const JWT_TTL = parseInt(process.env.JWT_TTL) || (90 * 24 * 60 * 60) // in s
const MONGO_URI = process.env.MONGO_URI
const MONGO_USER_DB = process.env.MONGO_USER_DB || 'eqreporting'
const MONGO_USER_COLL = process.env.MONGO_USER_COLL || 'equsers'
const OTP_TTL = parseInt(process.env.OTP_TTL) || (5 * 60 * 1000) // in ms

// one time passcode generator, by default 6-digit
// NOTE: at most 16-digit (or up to Math.random() implementation)
const getOtp = (digit = 6) => String(Math.random()).substring(2, digit + 2)

// get user from datastore and set otp
const loginUser = ({ user, otp, zone='utc' }) => {
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
          ttl: Number(moment().add(OTP_TTL, 'ms').format('x'))
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
    _otp.ttl = moment.tz(_otp.ttl, zone).format('LLLL z')
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
    subject: 'ATOM Login',
    text: `
      Welcome to ATOM.\n
      Please login with the magic link ${magicLink}\n
      Or manually enter: ${otp} \n
      This will expire after ${ttl}, and all previous email should be discarded.
    `,
    html: magicLinkEmail(magicLink, otp, ttl)
  }
  return nodemailer.createTransport({ SES: new AWS.SES() }).sendMail(message)
}

const signJwt = (userInfo) => (jwt.sign(userInfo, JWT_SECRET, { expiresIn: JWT_TTL }))

// get user from datastore and verify otp
const verifyOtp = ({ user, otp }) => {
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
    if (Number(moment().format('x')) >= _otp.ttl) {
      const err = new Error(`Passcode has expired for ${user}`)
      err.statusCode = 403
      throw err
    }
    return bcrypt.compare(otp, _otp.hash || '')
  }).then((res) => {
    if (!res) {
      const err = new Error(`Invalid passcode for ${user}`)
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
      token: signJwt(_userInfo)
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

const verifyJwt = (token) => jwt.verify(token, JWT_SECRET)

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

const checkRequired = ({
  userInfo,
  required=['email', 'api_access', 'jwt_uuid'],
}) => (required.every(k => k in userInfo))

module.exports = {
  getOtp,
  loginUser,
  sendOtp,
  signJwt,
  verifyOtp,
  verifyJwt,
  confirmUser,
  checkRequired,
}
