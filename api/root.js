/* / (root) */
const express = require('express')
const nodemailer = require('nodemailer')

const { loginUser, signJWT, verifyOTP, getUserInfo } = require('../modules/auth')
const { fullCheck } = require('../modules/access')
const { confirmed, hasQueryParams } = require('./middleware')
const { PRODUCT_ATOM } = require('../constants')


const router = express.Router()

// GET /
router.get('/', (_, res) => {
  let { KEYWARDEN_VER = 'N/A', STAGE = 'dev' } = process.env
  return res.json({
    STAGE,
    KEYWARDEN_VER,
  })
})

// GET /login
router.get('/login', hasQueryParams('user'), (req, res, next) => {
  const { user, redirect, zone, product = PRODUCT_ATOM, nolink } = req.query
  const { STAGE = 'dev' } = process.env
  let origin = `${req.protocol}://${req.get('host')}`
  if (STAGE) {
    origin += `/${STAGE}`
  }
  // login user and send OTP email
  return loginUser({
    user,
    redirect: decodeURIComponent(redirect || `${origin}/verify`),
    zone: decodeURIComponent(zone || 'utc'),
    product,
    nolink
  }).then((deliveryInfo) => {
    if (process.env.STAGE === 'local') { 
      if (deliveryInfo.response.startsWith('2')) { // looking for SMTP response code 200 or 250
        return res.json({
          message: `Local keywarden - OTP sent via Ethereal to ${deliveryInfo.accepted[0]}`,
          user: deliveryInfo.accepted[0],
          etherealUrl: nodemailer.getTestMessageUrl(deliveryInfo)
        })
      }
      throw new Error('Something went wrong sending the passcode.')
    }
    return res.json({
      message: `Login passcode sent to ${user} through email`,
      user,
    })
  }).catch(next)
})

// GET /verify
router.get('/verify', hasQueryParams('user', 'otp'), (req, res, next) => {
  const { user, reset_uuid, product, timeout } = req.query
  verifyOTP({
    ...req.query,
    reset_uuid: ['1', 'true'].includes(reset_uuid),
    product,
    timeout: parseInt(timeout),
  }).then(token => {
    return res.json({
      message: `User ${user} verified, please store and use the token responsibly`,
      user,
      token,
    })
  }).catch(next)
})

// GET /confirm
router.get('/confirm', confirmed({ allowLight: true }), (req, res) => {
  const { query: { product }, ttl, userInfo: { email: user, light } } = req
  return res.json({
    message: `Token confirmed for user ${user}`,
    user,
    light,
    product,
    ttl,
  })
})

// GET /refresh
router.get('/refresh', confirmed(), async (req, res) => {
  const { query: { newProduct = '' } } = req
  const { email } = req.userInfo
  req.userInfo = newProduct ? await getUserInfo({ email, product: newProduct.toLowerCase() }) : req.userInfo
  const { api_access = {}, jwt_uuid, prefix, product } = req.userInfo
  const token = signJWT({ email, api_access, jwt_uuid, prefix, product: product.toLowerCase() })

  return res.json({
    message: `Token refreshed for user ${email}, please store and use the token responsibly`,
    token,
    user: email,
  })
})

// GET /access
router.get('/access', confirmed(), (req, res) => {
  // extract access information from DB checked JWT
  const {
    prefix,
    api_access: { wl, customers, ...access },
    email,
  } = req.userInfo
  // extract target access information
  const {
    product, // omitted
    light, // omitted
    prefix: targetPrefix,
    wl: targetWL = '',
    customers: targetCustomers = '',
    ...targetAccess
  } = req.query
  // perform full access check
  fullCheck({
    target: {
      prefix: targetPrefix,
      access: targetAccess,
      clients: {
        wl: targetWL.split(',').filter(v => v),
        customers: targetCustomers.split(',').filter(v => v),
      },
    },
    me: {
      prefix,
      access,
      clients: { wl, customers },
    },
  })
  return res.json({
    email,
    prefix,
    wl,
    customers,
    ...access,
  })
})

module.exports = router
