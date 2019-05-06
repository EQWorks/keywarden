const express = require('express')
const api = express.Router()

const rootRouter = require('./root')
const usersRouter = require('./users')
const extRouter = require('./external')

api.use('/', rootRouter)
api.use('/users', usersRouter)
api.use('/external', extRouter)

module.exports = api
