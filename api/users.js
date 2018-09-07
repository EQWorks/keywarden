/* /users */
const express = require('express')
const router = express.Router()

const {
  getUsers,
  getUser,
  createUser,
  editUser,
  removeUser,
  deactivateUser,
  activateUser,
} = require('../modules/manage')
const { confirmed, hasQueryParams } = require('./middleware')

// GET /users
router.get('/', hasQueryParams('user'), confirmed(), (req, res, next) => {
  const { userInfo } = req
  const { product, user: email } = req.query
  getUser({ ...userInfo, product, email })
    .then(r => {
      return res.json(r)
    })
    .catch(next)
})

// GET /users/list
router.get('/list', confirmed(), (req, res, next) => {
  const { userInfo } = req
  const { product } = req.query
  getUsers({ ...userInfo, product })
    .then(r => {
      return res.json(r)
    })
    .catch(next)
})

// POST /users (for creation)
router.post('/', hasQueryParams('user'), confirmed(), (req, res, next) => {
  const { userInfo: { prefix, api_access } = {} } = req
  const { user, product = 'atom' } = req.query
  const userInfo = { ...(req.body || {}), email: user }
  createUser({ userInfo, prefix, api_access, product })
    .then(() => {
      return res.json({ message: `User ${user} created` })
    })
    .catch(next)
})

// PUT /users (for update)
router.put('/', hasQueryParams('user'), confirmed(), (req, res, next) => {
  const { userInfo: { prefix, api_access } = {} } = req
  const { user, product = 'atom' } = req.query
  const userInfo = { ...(req.body || {}), email: user }
  editUser({ userInfo, prefix, api_access, product })
    .then(() => {
      return res.json({ message: `User ${user} updated` })
    })
    .catch(next)
})

// PUT /users/activate
router.put('/activate', confirmed(), (req, res, next) => {
  const { userInfo: { prefix, api_access } = {} } = req
  const { product, user: email } = req.query
  getUser({ email, prefix, api_access, product })
    .then(({ user: userInfo }) => {
      return activateUser({ userInfo, prefix, api_access })
    })
    .then(() => {
      return res.json({ message: `User ${email} activated` })
    })
    .catch(next)
})

// PUT /users/deactivate
router.put('/deactivate', confirmed(), (req, res, next) => {
  const { userInfo: { prefix, api_access } = {} } = req
  const { product, user: email } = req.query
  getUser({ email, prefix, api_access, product })
    .then(({ user: userInfo }) => {
      return deactivateUser({ userInfo, prefix, api_access })
    })
    .then(() => {
      return res.json({ message: `User ${email} deactivated` })
    })
    .catch(next)
})

// delete
router.delete('/', confirmed(), (req, res, next) => {
  const { userInfo: { prefix, api_access } = {} } = req
  const { product, user: email } = req.query
  getUser({ email, prefix, api_access, product })
    .then(({ user: userInfo }) => {
      return removeUser({ prefix, api_access, userInfo })
    })
    .then(() => {
      return res.json({ message: `User ${email} deleted` })
    })
    .catch(next)
})

module.exports = router
