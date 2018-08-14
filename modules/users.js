const { MongoClient } = require('mongodb')
const bcrypt = require('bcryptjs')
const uuidv4 = require('uuid/v4')
const moment = require('moment')

const {
  MONGO_URI: URI,
  MONGO_USER_DB: DB = 'eqreporting',
  MONGO_USER_COLL: COLL = 'equsers',
  HASH_ROUND = 10,
  OTP_TTL = 5 * 60 * 1000,
} = process.env
// MongoDB connection options
const CONNECT_OPT = {
  useNewUrlParser: true,
  // total of 20s to be within API Gateway's 29s limit
  connectTimeoutMS: 5000,
  socketTimeoutMS: 15000,
}

const updateOTP = async ({ email, otp }) => {
  const client = await MongoClient.connect(URI, CONNECT_OPT)
  const hash = bcrypt.hashSync(otp, HASH_ROUND)
  const ttl = Number(moment().add(OTP_TTL, 'ms').format('x'))
  await client.db(DB).collection(COLL).updateOne({ email }, {
    $set: {
      otp: { hash, ttl }
    }
  })
  await client.close()
  return ttl
}

const validateOTP = async ({ email, otp, reset_uuid = false }) => {
  const client = await MongoClient.connect(URI, CONNECT_OPT)
  const coll = client.db(DB).collection(COLL)
  const userInfo = await coll.findOne({ email }, {
    projection: {
      _id: 0,
      otp: 1,
      api_access: 1,
      jwt_uuid: 1
    },
    maxTimeMS: 15 * 1000 // give it half of the 30 sec total limit
  })
  const {
    otp: _otp = {},
    api_access = {},
  } = userInfo
  let { jwt_uuid } = userInfo
  // check OTP expiration
  const now = Number(moment().format('x'))
  if (now >= _otp.ttl || 0) {
    const error = new Error(`Passcode has expired for ${email}`)
    error.statusCode = 403
    error.logLevel = 'WARNING'
    throw error
  }
  // validate OTP
  if (!bcrypt.compareSync(otp, _otp.hash || '')) {
    const error = new Error(`Invalid passcode for ${email}`)
    error.statusCode = 403
    error.logLevel = 'WARNING'
    throw error
  }
  // unset OTP from user
  const updates = {
    $unset: { otp: '' }
  }
  // set `jwt_uuid` if not set already
  if (reset_uuid || !jwt_uuid) {
    jwt_uuid = uuidv4()
    updates['$set'] = { jwt_uuid }
  }
  // update user
  await coll.updateOne({ email }, updates)
  await client.close()
  return { api_access, jwt_uuid }
}

const getUserInfo = async ({ email, fields=['api_access', 'jwt_uuid'] }) => {
  const client = await MongoClient.connect(URI, CONNECT_OPT)
  const projection = fields.reduce((o, v) => {
    o[v] = 1
    return o
  }, { _id: 0 })
  const userInfo = await client.db(DB).collection(COLL).findOne({ email }, {
    projection,
    maxTimeMS: 15 * 1000,
  })
  await client.close()
  return userInfo
}

const resetUUID = async ({ email }) => {
  const client = await MongoClient.connect(URI, CONNECT_OPT)
  const jwt_uuid = uuidv4()
  await client.db(DB).collection(COLL).updateOne({ email }, {
    $set: { jwt_uuid }
  })
  await client.close()
  return jwt_uuid
}

module.exports = {
  updateOTP,
  validateOTP,
  getUserInfo,
  resetUUID,
}
