/* /external */
const express = require('express')
const router = express.Router()

const { selectUser } = require('../modules/db')
const { signJWT } = require('../modules/auth')

const { README_LOCUS_SECRET } = process.env


// GET /readme direct link generation
router.get('/readme', (req, res, next) => {
  let { email, user } = req.query
  email = email || user
  const selects = ['prefix', 'client']
  selectUser({ email, selects }).then((userInfo) => {
    if (!userInfo) {
      return res.sendStatus(403)
    }
    const { client, prefix } = userInfo

    // `isReadOnly` is used for readme.io's access control
    const user = { email, name: email, prefix, isReadOnly: true, ...client }
    const link = `https://docs.locus.place/v1.0?auth_token=${signJWT(user, README_LOCUS_SECRET)}`
    return res.status(200).json({ message: 'Login link generated', link })
  }).catch(next)
})

module.exports = router
