const _sentry = require('@sentry/node')
const { KEYWARDEN_VER, SENTRY_URL, STAGE = 'dev' } = process.env

const LOG_LEVEL_WARNING = 'WARNING'
const LOG_LEVEL_ERROR = 'ERROR'

// IIFE to encapsulate sentry in namespace
const sentry = (() => {
  let sentryObj

  const initSentry = () => {
    _sentry.init({
      debug: STAGE === 'local',
      dsn: SENTRY_URL,
      release: KEYWARDEN_VER,
      environment: STAGE
    })
  
    // middleware to start monitoring request
    const requestHandler = _sentry.Handlers.requestHandler({
      request: ['headers', 'method', 'query_string', 'url'],
      serverName: false,
      user: ['email'],
    })
  
    // middleware to push error to Sentry
    const errorHandler = _sentry.Handlers.errorHandler({
      // only log to Sentry unknown errors or errors we have categorized as 'ERROR'
      shouldHandleError: (err) => err.logLevel === undefined || err.logLevel === LOG_LEVEL_ERROR,
    })
  
    // log errors outside error handler
    const logError = (err) => _sentry.captureException(err)
  
    return { client: _sentry, requestHandler, errorHandler, logError }
  
  }

  // returns sentryObj or call init if sentryObj has not been set
  return () => {
    if (sentryObj === undefined) {
      sentryObj = initSentry()
    }
    return sentryObj
  }

})()

class APIError extends Error {
  /**
   * Create a new instance of APIError
   * Accepts either a string (message) or an options object as unique argument
   * @param {(string|{message: string, statusCode: number, logLevel: string})} options
   * @return {APIError}
   */
  constructor(options) {
    const _options = typeof options === 'string' ? { message: options } : options || {}
    const { message = 'Error', statusCode = 500, logLevel } = _options

    super(message)
    this.name = 'APIError'
    this.statusCode = statusCode
    this.logLevel = logLevel || (statusCode >= 500 ? LOG_LEVEL_ERROR : LOG_LEVEL_WARNING)
  }

  /**
   * Get the public object representation of the error
   * @return {{message: string, statusCode: number, logLevel: string}}
   */
  export() {
    return {
      message: this.message,
      statusCode: this.statusCode,
      logLevel: this.logLevel,
    }
  }

  /**
   * Get the string representation of the error
   * @return {string}
   */
  toString() {
    return `[${this.logLevel}] - ${this.statusCode} - ${this.name}: ${this.message}`
  }

  /**
   * Create a new instance of APIError from Error object
   * Error supplied in constructor can be accessed via the 'originalError' property
   * @param {Error} err
   * @param {(string|{message: string, statusCode: number, logLevel: string})} options
   * @return {APIError}
   */
  static fromError(err, options) {
    const _options = typeof options === 'string' ? { message: options } : options || {}
    const newErr =  new (this)({ message: err.message, ..._options })
    newErr.originalError = err
    return newErr
  }

}

class AuthenticationError extends APIError {
  /**
   * Create a new instance of AuthenticationError
   * Accepts either a string (message) or an options object as unique argument
   * @param {(string|{message: string})} options
   * @return {AuthenticationError}
   */
  constructor(options) {
    const _options = typeof options === 'string' ? { message: options } : options || {}
    super({ ..._options, statusCode: 401, logLevel: LOG_LEVEL_WARNING })
    this.name = 'AuthenticationError'
  }
}

class AuthorizationError extends APIError {
  /**
   * Create a new instance of AuthorizationError
   * Accepts either a string (message) or an options object as unique argument
   * @param {(string|{message: string})} options
   * @return {AuthorizationError}
   */
  constructor(options) {
    const _options = typeof options === 'string' ? { message: options } : options || {}
    super({ ..._options, statusCode: 403, logLevel: LOG_LEVEL_WARNING })
    this.name = 'AuthorizationError'
  }
}

class InternalServerError extends APIError {
  /**
   * Create a new instance of InternalServerError
   * Accepts either a string (message) or an options object as unique argument
   * @param {(string|{message: string})} options
   * @return {InternalServerError}
   */
  constructor(options) {
    const _options = typeof options === 'string' ? { message: options } : options || {}
    super({ ..._options, message: _options.message || 'Internal Server Error', statusCode: 500, logLevel: LOG_LEVEL_ERROR })
    this.name = 'InternalServerError'
  }
}

// Use 'fromError' to decorate non-API errors (e.g. PG, third-party modules...)
class CustomError extends APIError {
  /**
   * Create a new instance of CustomError
   * Accepts either a string (message) or an options object as unique argument
   * @param {(string|{message: string, name: string, statusCode: number, logLevel: string})} options
   * @return {CustomError}
   */
  constructor(options) {
    super(options)
    const { name = 'UnknowError' } = typeof options !== 'string' && options || {}
    this.name = name
  }

  /**
   * Create a new instance of CustomError from Error object
   * Error supplied in constructor can be accessed via the 'originalError' property
   * @param {Error} err
   * @param {(string|{message: string, name: string, statusCode: number, logLevel: string})} options
   * @return {CustomError}
   */
  static fromError(err, options) {
    const _options = typeof options === 'string' ? { message: options } : options || {}
    return super.fromError(err, { name: err.name, ..._options })
  }
}

// catch-all error handler
// eslint disable otherwise not able to catch errors
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const isUnknownError = !(err instanceof APIError)
  // wrap unknown errors so they all have the same interface.
  // Substitute original error message so as to not expose private/implementation details
  const _err = isUnknownError ? InternalServerError.fromError(err) : err

  // log errors which not logged to Sentry
  if (_err.logLevel !== LOG_LEVEL_ERROR) {
    // log original error
    console.warn(err.stack || err)
  }

  // API response
  return res.status(_err.statusCode).json(_err.export())

}

module.exports = {
  APIError,
  AuthenticationError,
  AuthorizationError,
  InternalServerError,
  CustomError,
  sentry,
  errorHandler,
  LOG_LEVEL_ERROR,
  LOG_LEVEL_WARNING,
}
