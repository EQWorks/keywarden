const serverless = require('serverless-http')
const express = require('express')
const cors = require('cors')

const { initSentry, setupSentryErrorHandler, errorHandler } = require('./modules/errors')
const { rKillIdleOnExit, wKillIdleOnExit } = require('./modules/db')

const api = require('./api')

// initialize Sentry before express app
initSentry()

// express app
const app = express()
// trust proxy to get API Gateway/Cloud Front forwarded headers
app.enable('trust proxy')

// enable CORS for endpoints and their pre-flight requests (when applicable)
app.use(cors())
app.options('*', cors())
// bodyParser for json
app.use(express.json({ limit: '4mb' }))

// DB - close idle connections on exit
app.use(rKillIdleOnExit, wKillIdleOnExit)

// mount API endpoints by stage
app.use(`/${process.env.STAGE || 'dev'}`, api)

// Sentry error handler (must be before custom error handler)
setupSentryErrorHandler(app)

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
