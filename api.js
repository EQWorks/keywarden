/*********************************************************
* DO NOT modify this file directly on AWS Lambda console *
*********************************************************/
const url = require('url')

const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const uuidv4 = require('uuid/v4')
const { DateTime } = require('luxon')
const nodemailer = require('nodemailer')
const AWS = require('aws-sdk')
const MongoClient = require('mongodb').MongoClient

const JWT_SECRET = process.env.JWT_SECRET
const JWT_TTL = parseInt(process.env.JWT_TTL) || (90 * 24 * 60 * 60) // in s
const MONGO_URI = process.env.MONGO_URI
const MONGO_USER_DB = process.env.MONGO_USER_DB || 'eqreporting'
const MONGO_USER_COLL = process.env.MONGO_USER_COLL || 'equsers'
const OTP_TTL = parseInt(process.env.OTP_TTL) || (5 * 60 * 1000) // in ms

const CORS_HEADERS = () => {
  return {
    // Required for CORS support to work
    'Access-Control-Allow-Origin' : '*',
    // Required for cookies, authorization headers with HTTPS
    'Access-Control-Allow-Credentials' : true
  }
}

// one time passcode generator, by default 6-digit
// NOTE: at most 16-digit (or up to Math.random() implementation)
const getOtp = (digit = 6) => String(Math.random()).substring(2, digit + 2)

// get user from datastore and set otp
const loginUser = ({ user, otp }) => {
  let _client
  // find and update user with bcrypt'ed otp
  return MongoClient.connect(MONGO_URI).then((client) => {
    _client = client
    return bcrypt.hash(otp, 10)
  }).then((hash) => {
    return _client.db(MONGO_USER_DB).collection(MONGO_USER_COLL).findOneAndUpdate({
      email: user
    }, {
      $set: {
        otp: {
          hash,
          ttl: DateTime.utc().plus(OTP_TTL).valueOf()
        }
      }
    }, {
      projection: {
        _id: 0,
        email: 1,
        'otp.ttl': 1
      },
      maxTimeMS: 15 * 1000, // give it half of the 30 sec total limit
      returnOriginal: false
    })
  }).then((r) => {
    _client.close()
    const email = r.value.email
    const _otp = r.value.otp || {}
    _otp.ttl = DateTime.fromMillis(
      _otp.ttl,
      { zone: 'utc' }
    ).toLocaleString(DateTime.DATETIME_FULL_WITH_SECONDS)
    _otp.passcode = otp // assign plaintext value
    return {
      email,
      otp: _otp
    }
  }).catch((err) => {
    try {
      _client.close()
    } catch(err) {
      // ignore this
    }
    throw err
  })
}


// send email with otp
const sendOtp = ({ userInfo, redirect }) => {
  const otp = userInfo.otp.passcode // the plaintext version is only available from loginUser()
  const ttl = userInfo.otp.ttl
  // use `url` to parse original redirect
  const link = url.parse(redirect, true)
  link.query = link.query || {} // force link.query to be available
  Object.assign(link.query, { // add magic link query string params
    user: userInfo.email,
    otp
  })
  link.search = undefined // force search to be undfined to elevate link.query
  const magicLink = url.format(link) // reconstruct into magicLink
  const message = {
    from: 'dev@eqworks.com',
    to: userInfo.email,
    subject: 'EQ Works Login Authentication ',
    text: `
      Welcome to EQ Works!\n
      Please login with the magic link ${magicLink}\n
      Or manually enter: ${otp} \n
      This will exprie after ${ttl}, and all previous email should be discarded.
    `,
    html: `
     <head>
        <style>
          /* -------------------------------------
              GLOBAL RESETS
          ------------------------------------- */
          img {
            border: none;
            -ms-interpolation-mode: bicubic;
            max-width: 100%; }

          body {
            background-color: #f6f6f6;
            font-family: sans-serif;
            -webkit-font-smoothing: antialiased;
            font-size: 14px;
            line-height: 1.4;
            margin: 0;
            padding: 0;
            -ms-text-size-adjust: 100%;
            -webkit-text-size-adjust: 100%; }

          table {
            border-collapse: separate;
            mso-table-lspace: 0pt;
            mso-table-rspace: 0pt;
            width: 100%; }
            table td {
              font-family: sans-serif;
              font-size: 14px;
              vertical-align: top; }

          /* -------------------------------------
              BODY & CONTAINER
          ------------------------------------- */

          .body {
            background-color: #f6f6f6;
            width: 100%; }

          /* Set a max-width, and make it display as block so it will automatically stretch to that width, but will also shrink down on a phone or something */
          .container {
            display: block;
            Margin: 0 auto !important;
            /* makes it centered */
            max-width: 580px;
            padding: 10px;
            width: 580px; }

          /* This should also be a block element, so that it will fill 100% of the .container */
          .content {
            box-sizing: border-box;
            display: block;
            Margin: 0 auto;
            max-width: 580px;
            padding: 10px; }

          /* -------------------------------------
              HEADER, FOOTER, MAIN
          ------------------------------------- */
          .main {
            background: #fff;
            border-radius: 3px;
            width: 100%; }

          .wrapper {
            box-sizing: border-box;
            padding: 20px; }

          .footer {
            clear: both;
            padding-top: 10px;
            text-align: center;
            width: 100%; }
            .footer td,
            .footer p,
            .footer span,
            .footer a {
              color: #999999;
              font-size: 12px;
              text-align: center; }

          /* -------------------------------------
              TYPOGRAPHY
          ------------------------------------- */
          h1,
          h2,
          h3,
          h4 {
            color: #727272;
            font-family: sans-serif;
            font-weight: 400;
            line-height: 1.4;
            margin: 0;
            Margin-bottom: 30px; }

          h1 {
            font-size: 30px;
            font-weight: 400;
            text-align: center;
            }
          h2 {
            font-size: 20px;
            font-weight: 300;
            color:#3a3a3a;
            text-align: center;
            }
          h3 {
            font-size: 15px;
            font-weight: 300;
            color:#3a3a3a;
            line-height: 1.4;
            text-align: center;
            }
          h4 {
            font-size: 12px;
            color: #999999;
            text-align: center; 
            width: 60%;
            margin: 0 auto;
          }

          p,
          ul,
          ol {
            font-family: sans-serif;
            font-size: 14px;
            font-weight: normal;
            margin: 0;
            Margin-bottom: 0px; }
            p li,
            ul li,
            ol li {
              list-style-position: inside;
              margin-left: 5px; }

          a {
            color: #3498db;
            text-decoration: underline; }

          /* -------------------------------------
              BUTTONS
          ------------------------------------- */
          .btn {
            box-sizing: border-box;
            width: 100%;
            Margin-bottom: 30px;}
            .btn > tbody > tr > td {
              padding-bottom: 15px; }
            .btn table {
              width: auto;
            margin: 0 auto;}
            .btn table td {
              background-color: #ffffff;
              border-radius: 5px;
              text-align: center; }
            .btn a {
              background-color: #ffffff;
              border: solid 1px #6ba4f8;
              border-radius: 5px;
              box-sizing: border-box;
              color: #6ba4f8;
              cursor: pointer;
              display: inline-block;
              font-size: 20px;
              font-weight: bold;
              margin:0;
              padding: 12px 25px;
              text-decoration: none;
              text-transform: capitalize; }

          .btn-primary table td {
            background-color: #6ba4f8; }

          .btn-primary a {
            background-color: #6ba4f8;
            border-color: #6ba4f8;
            color: #ffffff; }

          /* -------------------------------------
              OTHER STYLES THAT MIGHT BE USEFUL
          ------------------------------------- */
          .last {
            margin-bottom: 0; }

          .first {
            margin-top: 0; }

          .align-center {
            text-align: center; }

          .align-right {
            text-align: right; }

          .align-left {
            text-align: left; }

          .clear {
            clear: both; }

          .mt0 {
            margin-top: 0; }

          .mb0 {
            margin-bottom: 0; }


          hr {
            border: 0;
            border-bottom: 1px solid #f6f6f6;
            Margin: 20px 0; }

          /* -------------------------------------
              RESPONSIVE AND MOBILE FRIENDLY STYLES
          ------------------------------------- */
          @media only screen and (max-width: 620px) {
            table[class=body] h1 {
              font-size: 28px !important;
              margin-bottom: 10px !important; }
            table[class=body] p,
            table[class=body] ul,
            table[class=body] ol,
            table[class=body] td,
            table[class=body] span,
            table[class=body] a {
              font-size: 16px !important; }
            table[class=body] .wrapper,
            table[class=body] .article {
              padding: 10px !important; }
            table[class=body] .content {
              padding: 0 !important; }
            table[class=body] .container {
              padding: 0 !important;
              width: 100% !important; }
            table[class=body] .main {
              border-left-width: 0 !important;
              border-radius: 0 !important;
              border-right-width: 0 !important; }
            table[class=body] .btn table {
              width: 100% !important; }
            table[class=body] .btn a {
              width: 100% !important; }
            table[class=body] .img-responsive {
              height: auto !important;
              max-width: 100% !important;
              width: auto !important; }}

          /* -------------------------------------
              PRESERVE THESE STYLES IN THE HEAD
          ------------------------------------- */
          @media all {
            .ExternalClass {
              width: 100%; }
            .ExternalClass,
            .ExternalClass p,
            .ExternalClass span,
            .ExternalClass font,
            .ExternalClass td,
            .ExternalClass div {
              line-height: 100%; }
            .apple-link a {
              color: inherit !important;
              font-family: inherit !important;
              font-size: inherit !important;
              font-weight: inherit !important;
              line-height: inherit !important;
              text-decoration: none !important; }
            .btn-primary table td:hover {
              background-color: #5582C5 !important; }
            .btn-primary a:hover {
              background-color: #5582C5 !important;
              border-color: #5582C5 !important; } }
        </style>
      </head>
      <body class="">
        <table border="0" cellpadding="0" cellspacing="0" class="body">
          <tr>
            <td>&nbsp;</td>
            <td class="container">
              <div class="content">

                <!-- START CENTERED WHITE CONTAINER -->
                <table class="main">

                  <!-- START MAIN CONTENT AREA -->
                  <tr>
                    <td class="wrapper">
                      <table border="0" cellpadding="0" cellspacing="0">
                        <tr>
                          <td>
                            <h1>Welcome to EQ Works!</h1>
                            <table border="0" cellpadding="0" cellspacing="0" class="btn btn-primary">
                              <tbody>
                                <tr>
                                  <td align="left">
                                    <table border="0" cellpadding="0" cellspacing="0">
                                      <tbody>
                                        <tr>
                                          <td> <a href="${magicLink}" target="_blank">Sign in with Magic Link</a> </td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                            <h3><p>Magic link doesn't work for you? </p>
                              <p>Use the one-time passcode <strong> ${otp}. </strong></p>
                            </h3>
                            <h4>This will exprie after ${ttl}, and all previous email should be discarded.</h4>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- END MAIN CONTENT AREA -->
                  </table>

                <!-- START FOOTER -->
                <div class="footer">
                  <table border="0" cellpadding="0" cellspacing="0">
                    <tr>
                      <td class="content-block">
                        <span class="apple-link">© EQ Works Inc</span>
                        <br> Have a Login issue?  <a href="mailto:dev@eqworks.com?subject=EQ Works Login Issue">Contact Us</a>.
                      </td>
                    </tr>
                  </table>
                </div>

                <!-- END FOOTER -->

              </div>
            </td>
            <td>&nbsp;</td>
          </tr>
        </table>
      </body>
    `
  }
  return nodemailer.createTransport({ SES: new AWS.SES() }).sendMail(message)
}

// get user from datastore and verify otp
const verifyUser = ({ user, otp }) => {
  let _client
  let _userInfo
  let _col
  // find user with otp hash
  return MongoClient.connect(MONGO_URI).then((client) => {
    _client = client
    _col = _client.db(MONGO_USER_DB).collection(MONGO_USER_COLL)
    return _col.findOne({
      email: user
    }, {
      projection: {
        _id: 0,
        email: 1,
        otp: 1,
        api_access: 1,
        jwt_uuid: 1
      },
      maxTimeMS: 15 * 1000 // give it half of the 30 sec total limit
    })
  }).then((doc) => {
    // carve out email and api_access for later signing
    const { email, api_access, jwt_uuid } = doc
    _userInfo = { email, api_access, jwt_uuid }
    // otp verification
    const _otp = doc.otp || {}
    if (DateTime.utc().valueOf() >= _otp.ttl) {
      const err = new Error('Passcode has expired')
      err.statusCode = 403
      throw err
    }
    return bcrypt.compare(otp, _otp.hash || '')
  }).then((res) => {
    if (!res) {
      const err = new Error('Invalid passcode')
      err.statusCode = 403
      throw err
    }
    // unset otp
    const updates = {
      $unset: { otp: '' }
    }
    // set `jwt_uuid` if not set already
    if (!_userInfo.jwt_uuid) {
      _userInfo.jwt_uuid = uuidv4()
      updates['$set'] = {
        jwt_uuid: _userInfo.jwt_uuid
      }
    }
    // update the user with desired updates
    return _col.updateOne({
      email: user
    }, updates)
  }).then(() => {
    _client.close()
    // passcode checked, generate jwt and return
    return {
      token: jwt.sign(_userInfo, JWT_SECRET, { expiresIn: JWT_TTL })
    }
  }).catch((err) => {
    try {
      _client.close()
    } catch(err) {
      // ignore this
    }
    throw err
  })
}

// HTTP GET /login
module.exports.login = (event, context, callback) => {
  // get various info needed from event (API Gateway - LAMBDA PROXY)
  // `user` is in the form of an email address
  // `redirect` is used for signaling requesting application
  // which URI to redirect to after /verify successfully
  let { user, redirect } = event.queryStringParameters || {}
  if (!user) {
    return callback(null, {
      statusCode: 400,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: 'Missing `user` in query string parameters'
      })
    })
  }
  // origin and stage are used for composing the verify link
  const headers = event.headers || {}
  const origin = `${headers['X-Forwarded-Proto']}://${headers.Host}`
  const { stage } = event.requestContext || {}
  // grab an otp
  const otp = getOtp()
  // get user and set its otp
  return loginUser({ user, otp }).then((userInfo) => {
    // default redirect back to keywarden for manual verification
    redirect = redirect || `${origin}/${stage}/verify`
    return sendOtp({ userInfo, redirect })
  }).then((info) => {
    console.log(info)
    return callback(null, {
      statusCode: 200,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: `Login passcode has been sent to ${user} through email`,
        user
      })
    })
  }).catch((err) => {
    console.error(err.stack || err)
    return callback(null, {
      statusCode: err.statusCode || 500,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: `Unable to login user ${user} - ${err.message || 'server error'}`,
        user
      })
    })
  })
}

// HTTP GET /verify
module.exports.verify = (event, context, callback) => {
  const { user, otp } = event.queryStringParameters || {}
  if (!user) {
    return callback(null, {
      statusCode: 400,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: 'Missing `user` in query string parameters'
      })
    })
  }
  if (!otp) {
    return callback(null, {
      statusCode: 400,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: 'Missing `otp` in query string parameters'
      })
    })
  }
  verifyUser({ user, otp }).then((res) => {
    const { token } = res
    return callback(null, {
      statusCode: 200,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: `User ${user} verified, please store and use the attached token responsibly`,
        user,
        token // this contains { email, api_access }
      })
    })
  }).catch((err) => {
    console.error(err.stack || err)
    return callback(null, {
      statusCode: err.statusCode || 500,
      headers: CORS_HEADERS(),
      body: JSON.stringify({
        message: `Unable to verify user ${user} - ${err.message || 'server error'}`
      })
    })
  })
}
