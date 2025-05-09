const nodemailer = require('nodemailer')
const AWS = require('@aws-sdk/client-ses')
const { capitalizeFirstLetter } = require('./utils')


module.exports.sendMail = async message => {
  let transport
  // if we are in a local environment, bypass SES and bypass requested recipient in favour of ethereal.email generated accounts
  if (process.env.STAGE === 'local') {
    let testSender = await nodemailer.createTestAccount()
    let testRecipient = await nodemailer.createTestAccount()
    message.from = testSender.user
    message.to = testRecipient.user
    transport = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: {
        user: testSender.user,
        pass: testSender.pass,
      },
    })
  }
  else {
    transport = nodemailer.createTransport({
      SES: new AWS.SES(),
    })
  }
  return transport.sendMail(message)
}

module.exports.magicLinkHTML = ({ link, otp, ttl, company, product, supportEmail }) => `
  <!DOCTYPE html>
  <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8"> <!-- utf-8 works for most cases -->
    <meta name="viewport" content="width=device-width"> <!-- Forcing initial-scale shouldn't be necessary -->
    <meta http-equiv="X-UA-Compatible" content="IE=edge"> <!-- Use the latest (edge) version of IE rendering engine -->
    <meta name="x-apple-disable-message-reformatting">  <!-- Disable auto-scale in iOS 10 Mail entirely -->
    <title>${capitalizeFirstLetter(product)} (${company}) Login Magic Link</title> <!-- The title tag shows in email notifications, like Android 4.4. -->

    <!-- Web Font / @font-face : BEGIN -->
    <!-- NOTE: If web fonts are not required, lines 10 - 27 can be safely removed. -->

    <!-- Desktop Outlook chokes on web font references and defaults to Times New Roman, so we force a safe fallback font. -->
    <!--[if mso]>
      <style>
        * {
          font-family: sans-serif !important;
        }
      </style>
    <![endif]-->

    <!-- All other clients get the webfont reference; some will render the font and others will silently fail to the fallbacks. More on that here: http://stylecampaign.com/blog/2015/02/webfont-support-in-email/ -->
    <!--[if !mso]><!-->
    <!-- insert web font reference, eg: <link href='https://fonts.googleapis.com/css?family=Roboto:400,700' rel='stylesheet' type='text/css'> -->
    <!--<![endif]-->

    <!-- Web Font / @font-face : END -->

    <!-- CSS Reset : BEGIN -->
    <style>

      /* What it does: Remove spaces around the email design added by some email clients. */
      /* Beware: It can remove the padding / margin and add a background color to the compose a reply window. */
      html,
      body {
        margin: 0 auto !important;
        padding: 0 !important;
        height: 100% !important;
        width: 100% !important;
      }

      /* What it does: Stops email clients resizing small text. */
      * {
        -ms-text-size-adjust: 100%;
        -webkit-text-size-adjust: 100%;
      }

      /* What it does: Centers email on Android 4.4 */
      div[style*="margin: 16px 0"] {
        margin: 0 !important;
      }

      /* What it does: Stops Outlook from adding extra spacing to tables. */
      table,
      td {
        mso-table-lspace: 0pt !important;
        mso-table-rspace: 0pt !important;
      }

      /* What it does: Fixes webkit padding issue. Fix for Yahoo mail table alignment bug. Applies table-layout to the first 2 tables then removes for anything nested deeper. */
      table {
        border-spacing: 0 !important;
        border-collapse: collapse !important;
        table-layout: fixed !important;
        margin: 0 auto !important;
      }
      table table table {
        table-layout: auto;
      }

      /* What it does: Uses a better rendering method when resizing images in IE. */
      img {
        -ms-interpolation-mode:bicubic;
      }

      /* What it does: Prevents Windows 10 Mail from underlining links despite inline CSS. Styles for underlined links should be inline. */
      a {
        text-decoration: none;
      }

      /* What it does: A work-around for email clients meddling in triggered links. */
      *[x-apple-data-detectors],  /* iOS */
      .unstyle-auto-detected-links *,
      .aBn {
        border-bottom: 0 !important;
        cursor: default !important;
        color: inherit !important;
        text-decoration: none !important;
        font-size: inherit !important;
        font-family: inherit !important;
        font-weight: inherit !important;
        line-height: inherit !important;
      }

      /* What it does: Prevents Gmail from displaying a download button on large, non-linked images. */
      .a6S {
        display: none !important;
        opacity: 0.01 !important;
      }
      /* If the above doesn't work, add a .g-img class to any image in question. */
      img.g-img + div {
        display: none !important;
      }

      /* What it does: Removes right gutter in Gmail iOS app: https://github.com/TedGoas/Cerberus/issues/89  */
      /* Create one of these media queries for each additional viewport size you'd like to fix */

      /* iPhone 4, 4S, 5, 5S, 5C, and 5SE */
      @media only screen and (min-device-width: 320px) and (max-device-width: 374px) {
        .email-container {
          min-width: 320px !important;
        }
      }
      /* iPhone 6, 6S, 7, 8, and X */
      @media only screen and (min-device-width: 375px) and (max-device-width: 413px) {
        .email-container {
          min-width: 375px !important;
        }
      }
      /* iPhone 6+, 7+, and 8+ */
      @media only screen and (min-device-width: 414px) {
        .email-container {
          min-width: 414px !important;
        }
      }

    </style>
    <!-- CSS Reset : END -->
    <!-- Reset list spacing because Outlook ignores much of our inline CSS. -->
    <!--[if mso]>
    <style type="text/css">
      ul,
      ol {
        margin: 0 !important;
      }
      li {
        margin-left: 30px !important;
      }
      li.list-item-first {
        margin-top: 0 !important;
      }
      li.list-item-last {
        margin-bottom: 10px !important;
      }
    </style>
    <![endif]-->

    <!-- Progressive Enhancements : BEGIN -->
    <style>

      /* What it does: Hover styles for buttons */
      .button-td,
      .button-a {
        transition: all 100ms ease-in;
      }
      .button-td-primary:hover,
      .button-a-primary:hover {
        background: #555555 !important;
        border-color: #555555 !important;
      }

      /* Media Queries */
      @media screen and (max-width: 600px) {

        /* What it does: Adjust typography on small screens to improve readability */
        .email-container p {
          font-size: 17px !important;
        }

      }

    </style>
    <!-- Progressive Enhancements : END -->

    <!-- What it does: Makes background images in 72ppi Outlook render at correct size. -->
    <!--[if gte mso 9]>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
    <![endif]-->
  </head>
  <!--
    The email background color (#ffffff) is defined in three places:
    1. body tag: for most email clients
    2. center tag: for Gmail and Inbox mobile apps and web versions of Gmail, GSuite, Inbox, Yahoo, AOL, Libero, Comcast, freenet, Mail.ru, Orange.fr
    3. mso conditional: For Windows 10 Mail
  -->
  <body width="100%" style="margin: 0; padding: 0 !important; mso-line-height-rule: exactly; background-color: #ffffff;">
    <center style="width: 100%; background-color: #ffffff;">
    <!--[if mso | IE]>
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #ffffff;">
    <tr>
    <td>
    <![endif]-->

      <!-- Visually Hidden Preheader Text : BEGIN -->
      <div style="display: none; font-size: 1px; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all; font-family: sans-serif;">
        ${capitalizeFirstLetter(product)} (${company}) Login Magic Link
      </div>
      <!-- Visually Hidden Preheader Text : END -->

      <!-- Create white space after the desired preview text so email clients don’t pull other distracting text into the inbox preview. Extend as necessary. -->
      <!-- Preview Text Spacing Hack : BEGIN -->
      <div style="display: none; font-size: 1px; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all; font-family: sans-serif;">
        &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
      </div>
      <!-- Preview Text Spacing Hack : END -->

      <!--
        Set the email width. Defined in two places:
        1. max-width for all clients except Desktop Windows Outlook, allowing the email to squish on narrow but never go wider than 600px.
        2. MSO tags for Desktop Windows Outlook enforce a 600px width.
      -->
      <div style="max-width: 600px; margin: 0 auto;" class="email-container">
        <!--[if mso]>
        <table align="center" role="presentation" cellspacing="0" cellpadding="0" border="0" width="600">
        <tr>
        <td>
        <![endif]-->

        <!-- Email Body : BEGIN -->
        <table align="center" role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 auto;">
          <!-- 1 Column Text + Button : BEGIN -->
          <tr>
            <td style="background-color: #ffffff;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="padding: 10px; font-family: sans-serif; font-size: 15px; line-height: 20px; color: #555555; text-align: center;">
                    <h1 style="margin: 0 0 10px 0; font-family: sans-serif; font-size: 25px; line-height: 30px; color: #333333; font-weight: normal;">Welcome to ${capitalizeFirstLetter(product)} (${company})</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 20px;">
                    <!-- Button : BEGIN -->
                    <table align="center" role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: auto;">
                      <tr>
                        <td class="button-td button-td-primary" style="border-radius: 4px; background: #6BA4F8;">
                          <a class="button-a button-a-primary" href="${link}" style="background: #6BA4F8; border: 1px solid #DDDDDD; font-family: sans-serif; font-size: 18px; line-height: 18px; text-decoration: none; padding: 17px 20px; color: #ffffff; display: block; border-radius: 4px;">Login with the Magic Link on this device</a>
                        </td>
                      </tr>
                    </table>
                    <!-- Button : END -->
                  </td>
                </tr>
                ${otp && ttl ? `<tr>
                  <td style="padding: 10px; font-family: sans-serif; font-size: 15px; line-height: 20px; color: #555555; text-align: center;">
                    <p>Or use the one-time passcode</p>
                    <p><strong>${otp}</strong></p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px; font-family: sans-serif; font-size: 12px; line-height: 15px; color: #888888; text-align: center;">
                    <p>This will expire after ${ttl}, and all previous email should be discarded.</p>
                  </td>
                </tr>` : ''}
              </table>
            </td>
          </tr>
          <!-- 1 Column Text + Button : END -->
        </table>
        <!-- Email Body : END -->

        <!-- Email Footer : BEGIN -->
        <table align="center" role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 auto;">
          <tr>
            <td style="padding: 5px; font-family: sans-serif; font-size: 12px; line-height: 15px; text-align: center; color: #888888;">
              <hr>
              <p>Having an issue? <a style="color: #6BA4F8;" href="mailto:${supportEmail}?subject=${capitalizeFirstLetter(product)} (${company}) Login issue">Contact Us</a></p>
            </td>
          </tr>
        </table>
        <!-- Email Footer : END -->

        <!--[if mso]>
        </td>
        </tr>
        </table>
        <![endif]-->
      </div>
    <!--[if mso | IE]>
    </td>
    </tr>
    </table>
    <![endif]-->
    </center>
  </body>
  </html>
`

module.exports.otpText = ({ link, otp, ttl, company, product }) => `
  Welcome to ${capitalizeFirstLetter(product)} (${company})\n
  ${link ? `Please login with the magic link ${link}\n` : ''}
  ${otp && ttl ? `Or manually enter: ${otp} \n
  This will expire after ${ttl}, and all previous email should be discarded.` : ''}
`
