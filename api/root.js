/* / (root) */
const express = require('express')
const router = express.Router()

const { loginUser, signJWT, verifyOTP } = require('../modules/auth')
const { confirmed, hasQueryParams } = require('./middleware')

// GET /
router.get('/', (req, res) => {
  let { KEYWARDEN_VER, STAGE } = process.env
  return res.json({
    STAGE,
    KEYWARDEN_VER,
  })
})

// GET /login
router.get('/login', hasQueryParams('user'), (req, res, next) => {
  const { user, redirect, zone } = req.query
  const { STAGE } = process.env
  let origin = `${req.protocol}://${req.get('host')}`
  if (STAGE) {
    origin += `/${STAGE}`
  }
  // login user and send OTP email
  return loginUser({
    user,
    redirect: decodeURIComponent(redirect || `${origin}/verify`),
    zone: decodeURIComponent(zone || 'utc'),
  }).then(() => {
    return res.json({ message: `Login passcode sent to ${user} through email`, user })
  }).catch(next)
})

// GET /verify
router.get('/verify', hasQueryParams('user', 'otp'), (req, res, next) => {
  const { user, reset_uuid } = req.query
  verifyOTP({
    ...req.query,
    reset_uuid: ['1', 'true'].includes(reset_uuid),
  }).then((token) => {
    return res.json({
      message: `User ${user} verified, please store and use the token responsibly`,
      user,
      token,
    })
  }).catch(next)
})

// GET /confirm
router.get('/confirm', confirmed, (req, res) => {
  const { email: user, light } = req.userInfo
  return res.json({ message: `Token confirmed for user ${user}`, user, light })
})

// GET /refresh
router.get('/refresh', confirmed, (req, res) => {
  const { email, api_access, jwt_uuid } = req.userInfo
  const token = signJWT({ email, api_access, jwt_uuid })
  return res.json({
    message: `Token refreshed for user ${email}, please store and use the token responsibly`,
    token,
    user: email,
  })
})

// GET /access
router.get('/access', confirmed, (req, res) => {
  const { email: user, api_access, jwt_uuid, product } = req.userInfo
  return res.json({
    user,
    api_access,
    jwt_uuid,
    product,
  })
})

module.exports = router
