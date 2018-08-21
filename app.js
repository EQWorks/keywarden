const serverless = require('serverless-http')
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')

const api = require('./api.js')

// express app
const app = express()
// trust proxy to get API Gateway/Cloud Front forwarded headers
app.enable('trust proxy')
// enable CORS for endpoints and their pre-flight requests (when applicable)
app.use(cors())
app.options('*', cors())
// bodyParser for json
app.use(bodyParser.json())

// mount API endpoints by stage
app.use(`/${process.env.STAGE}`, api)

// catch-all error handler
// eslint disable otherwise not able to catch errors
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let { logLevel, statusCode } = err
  const { message } = err
  logLevel = logLevel || 'ERROR'
  statusCode = statusCode || 500
  // app log
  console.log(`[${logLevel}] - ${statusCode} - ${message}`)
  if (logLevel === 'ERROR') {
    console.error(`[ERROR] ${message}`, err.stack || err)
  }
  // API response
  return res.status(statusCode).json({
    statusCode,
    logLevel,
    message,
  })
})

if (require.main === module) {
  app.listen(3333, () => {
    console.log('Listening on port 3333')
  })
} else {
  module.exports.handler = serverless(app)
}
