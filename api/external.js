/* /external */
const express = require('express')
const router = express.Router()

const { selectUser } = require('../modules/db')
const { signJWT } = require('../modules/auth')
const { sendMail, magicLinkHTML, magicLinkText } = require('../modules/email.js')

const { README_LOCUS_SECRET } = process.env


// GET /readme direct link generation
router.get('/readme', (req, res, next) => {
  let { email, user } = req.query
  email = email || user
  const selects = ['prefix', 'client']
  selectUser({ email, selects }).then(({ user: { client, prefix } }) => {
    if (!client) {
      return res.sendStatus(403)
    }
    const user = { email, name: email, prefix, ...client }
    const link = `https://docs.locus.place/v1.0?auth_token=${signJWT(user, README_LOCUS_SECRET)}`
    return res.status(200).json({ message: 'Login link generated', link })
  }).catch(next)
})

// GET /readme/login through email workflow
router.get('/readme/login', (req, res, next) => {
  let { email, user } = req.query
  email = email || user
  const selects = ['prefix', 'client']
  selectUser({ email, selects }).then(({ user: { client, prefix } }) => {
    const user = { email, name: email, prefix, ...client }
    const link = `http://docs.locus.place/v1.0?auth_token=${signJWT(user, README_LOCUS_SECRET)}`
    const company = 'EQ Works'
    const product = 'LOCUS Developer Hub'
    const message = {
      from: 'dev@eqworks.com',
      to: email,
      subject: `${product} (${company}) Login`,
      text: magicLinkText({ link, company, product }),
      html: magicLinkHTML({ link, company, product }),
    }
    return sendMail(message)
  }).then(() => {
    return res.status(200).json({
      message: `Login magic link sent to ${email} through email`,
      email,
    })
  }).catch(next)
})

module.exports = router
