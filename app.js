const serverless = require('serverless-http')
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const { sentry, errorHandler } = require('./modules/errors')

const api = require('./api')

// express app
const app = express()
// trust proxy to get API Gateway/Cloud Front forwarded headers
app.enable('trust proxy')

// allow Sentry to access the reques
app.use(sentry().requestHandler)

// enable CORS for endpoints and their pre-flight requests (when applicable)
app.use(cors())
app.options('*', cors())
// bodyParser for json
app.use(bodyParser.json())

// mount API endpoints by stage
app.use(`/${process.env.STAGE || 'dev'}`, api)

// log all errors to Sentry
app.use(sentry().errorHandler)

// catch-all error handler
app.use(errorHandler)

if (require.main === module) {
  app.listen(3333, () => {
    // eslint-disable-next-line no-console
    console.log('Listening on port 3333')
  })
} else {
  module.exports.handler = serverless(app)
}
