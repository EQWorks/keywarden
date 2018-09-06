const express = require('express')
const api = express.Router()

const rootRouter = require('./root')
const usersRouter = require('./users')

api.use('/', rootRouter)
api.use('/users', usersRouter)

module.exports = api
