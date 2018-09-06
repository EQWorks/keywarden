/* /users */
const express = require('express')
const router = express.Router()

const { getUser, getUsers, editUser, removeUser } = require('../modules/manage')
const { confirmed, hasQueryParams } = require('./middleware')

// GET /users
router.get('/', hasQueryParams('user'), confirmed, (req, res, next) => {
  const { userInfo } = req
  const { product, user: email } = req.query
  getUser({ ...userInfo, product, email }).then((r) => {
    return res.json(r)
  }).catch(next)
})

// GET /users/list
router.get('/list', confirmed, (req, res, next) => {
  const { userInfo } = req
  const { product } = req.query
  getUsers({ ...userInfo, product }).then((r) => {
    return res.json(r)
  }).catch(next)
})

// POST /users (for creation)
router.post('/', hasQueryParams('user'), confirmed, (req, res, next) => {
  const { userInfo: { prefix, api_access } = {} } = req
  const { user, product='atom' } = req.query
  const userInfo = { ...(req.body || {}), email: user }
  editUser({ userInfo, prefix, api_access, product, newUser: true }).then(() => {
    return res.json({ message: `User ${user} created` })
  }).catch(next)
})

// PUT /users (for update)
router.put('/', hasQueryParams('user'), confirmed, (req, res, next) => {
  const { userInfo: { prefix, api_access } = {} } = req
  const { user, product='atom' } = req.query
  const userInfo = { ...(req.body || {}), email: user }
  editUser({ userInfo, prefix, api_access, product, newUser: false }).then(() => {
    return res.json({ message: `User ${user} updated` })
  }).catch(next)
})

// delete
router.delete('/', confirmed, (req, res, next) => {
  const { userInfo: { prefix, api_access } = {} } = req
  const { hard, product, user: email } = req.query
  const deactivate = !['1', 'true'].includes(hard)
  getUser({ email, prefix, api_access, product }).then((r) => {
    return removeUser({ prefix, api_access, userInfo: r, hard: !deactivate })
  }).then(() => {
    return res.json({ message: `User ${email} ${deactivate ? 'deactivated' : 'deleted'}` })
  }).catch(next)
})

module.exports = router
