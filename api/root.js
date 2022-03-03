/* / (root) */
const express = require('express')
const nodemailer = require('nodemailer')

const { loginUser, signJWT, verifyOTP, getUserInfo } = require('../modules/auth')
const { fullCheck } = require('../modules/access')
const { confirmed, hasQueryParams } = require('./middleware')
const { PRODUCT_ATOM, PREFIX_MOBILE_SDK } = require('../constants')
const { APIError, InternalServerError } = require('../modules/errors')


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
router.get('/login', hasQueryParams('user'), async (req, res, next) => {
  try {
    const { user, redirect, zone, product = PRODUCT_ATOM, nolink } = req.query
    const { STAGE = 'dev' } = process.env
    let origin = `${req.protocol}://${req.get('host')}`
    if (STAGE) {
      origin += `/${STAGE}`
    }
    // login user and send OTP email
    const deliveryInfo = await loginUser({
      user,
      redirect: decodeURIComponent(redirect || `${origin}/verify`),
      zone: decodeURIComponent(zone || 'utc'),
      product: product.toLowerCase(),
      nolink
    })


    if (process.env.STAGE === 'local') {
      if (!deliveryInfo.response.startsWith('2')) { // looking for SMTP response code 200 or 250
        throw new InternalServerError('Something went wrong sending the passcode.')
      }
      return res.json({
        message: `Local keywarden - OTP sent via Ethereal to ${deliveryInfo.accepted[0]}`,
        user: deliveryInfo.accepted[0],
        etherealUrl: nodemailer.getTestMessageUrl(deliveryInfo)
      })
    }
    return res.json({
      message: `Login passcode sent to ${user} through email`,
      user,
    })
  } catch (err) {
    if (err instanceof APIError) {
      return next(err)
    }
    next(InternalServerError.fromError(err, 'Failed to complete the login process'))
  }
})

// GET /verify
router.get('/verify', hasQueryParams('user', 'otp'), async (req, res, next) => {
  try {
    const { user: email, otp, reset_uuid, product = PRODUCT_ATOM, timeout } = req.query
    const { token, api_access, prefix } = await verifyOTP({
      email,
      otp,
      reset_uuid: ['1', 'true'].includes(reset_uuid),
      product: product.toLowerCase(),
      timeout: parseInt(timeout) || undefined,
    })
    return res.json({
      message: `User ${email} verified, please store and use the token responsibly`,
      email,
      token,
      access: {
        ...api_access,
        prefix
      }
    })
  } catch (err) {
    if (err instanceof APIError) {
      return next(err)
    }
    next(InternalServerError.fromError(err, 'Failed to verify the OTP'))
  }
})

// GET /confirm
router.get('/confirm', confirmed({ allowLight: true }), (req, res) => {
  const { query: { product }, ttl, userInfo: { email: user, light, api_access, prefix } } = req
  return res.json({
    message: `Token confirmed for user ${user}`,
    user,
    light,
    product,
    ttl,
    access: {
      ...api_access,
      prefix,
    }
  })
})

// GET /refresh
router.get(
  '/refresh',
  confirmed({ forceLight: ({ prefix }) => prefix === PREFIX_MOBILE_SDK }),
  async (req, res, next) => {
    try {
      const { query: { newProduct, timeout } } = req
      let { userInfo } = req
      const { email, light, product, prefix } = userInfo
      const safeNewProduct = newProduct ? newProduct.toLowerCase() : undefined

      if (light || safeNewProduct !== product) {
        // need to fetch user info as req.userInfo = value in supplied jwt
        userInfo = await getUserInfo({
          email,
          product: safeNewProduct && prefix !== PREFIX_MOBILE_SDK ? safeNewProduct : product,
        })
      }

      const token = signJWT(userInfo, { timeout })
      const { api_access } = userInfo

      return res.json({
        message: `Token refreshed for user ${email}, please store and use the token responsibly`,
        token,
        user: email,
        access: {
          ...api_access,
          prefix,
        }
      })
    } catch (err) {
      if (err instanceof APIError) {
        return next(err)
      }
      next(InternalServerError.fromError(err, 'Failed to refresh the token'))
    }
  },
)

// GET /access
router.get('/access', confirmed(), (req, res, next) => {
  try {
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
        access: {
          ...targetAccess,
          prefix: targetPrefix,
        },
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
  } catch (err) {
    if (err instanceof APIError) {
      return next(err)
    }
    next(InternalServerError.fromError(err, 'Failed to confirm access permissions'))
  }
})

module.exports = router
