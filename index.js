const SpacebroClient = require('spacebro-client').SpacebroClient
const standardSettings = require('standard-settings')
const MailListener = require('mail-listener-fixed')
const jsdom = require('jsdom')
const striptags = require('striptags')
const { JSDOM } = jsdom
const nanoid = require('nanoid')
// const download = require('download')
const express = require('express')
const path = require('path')
const mkdirp = require('mkdirp')
const fs = require('fs-extra')
const util = require('util')
const writeFileAsync = util.promisify(fs.writeFile)
const _ = require('lodash')
const splitLines = require('split-lines')
const helpers = require('./lib/helpers')
const winston = require('winston')
const assignment = require('assignment')
const slugify = require('@sindresorhus/slugify')
const slash = require('slash')
var settings = standardSettings.getSettings()

var spacebroClient = new SpacebroClient()
_.set(settings.service.mail, 'attachmentOptions.directory', settings.folder.output + '/')
settings.service.mail.debug = console.log
var mailListener = new MailListener(settings.service.mail)
const log = winston.createLogger({
  level: settings.logger.level,
  format: winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.splat(),
    winston.format.simple()
  ),
  transports: [
    new winston.transports.Console()
  ]
})

try {
  mkdirp(settings.folder.output)
  mkdirp(settings.folder.tmp)
} catch (err) {
  log.error('can\'t create folder')
}

let getBucketAndToken = (address) => {
  let bucketAndToken = {}
  if (address === undefined) {
    return bucketAndToken
  }
  let parts = address.split('@')
  let localpart = parts[0]
  parts = localpart.split('?')
  bucketAndToken.bucket = parts[0]
  if (parts && parts.length > 1) {
    let params = parts[1].split('&')
    for (let param of params) {
      parts = param.split('=')
      let key = parts[0]
      let value
      if (parts && parts.length > 1) {
        value = parts[1]
      }
      bucketAndToken[key] = value
    }
  }
  return bucketAndToken
}

let parseBody = async (htmlText) => {
  log.info('🤖 - start parsing body')
  log.debug(htmlText)
  let params = {}
  if (htmlText) {
    const dom = new JSDOM(htmlText)
    let body = dom.window.document.querySelector('body').textContent.trim()
    log.debug('body:')
    log.debug(body)
    body = striptags(body)
    let lines = splitLines(body)
    lines.forEach(el => {
      log.debug('line:')
      log.debug(el)
      let section = el.split(':')
      if (section.length === 2) {
        params[section[0].toLowerCase().trim()] = section[1].trim()
      }
    })
    log.debug('params:')
    log.debug(params)
  }
  return params
}

let mailListenerMediaToStandardMedia = async (mail) => {
  log.info('🏭 - transform email media to standard media')
  let mailObject = JSON.parse(JSON.stringify(mail))
  delete mailObject.attachments
  delete mailObject.eml
  let media = {
    meta: {
      email: mail.to.text,
      melkibro: mailObject
    }
  }

  if (mail.attachments && mail.attachments.length) {
    log.debug('📎 - attachments found')
    let file = mail.attachments[0]
    let fileName
    if(!file.filename) {
      fileName = nanoid()
      fileName = `${fileName}.${file.contentType.split('/').pop()}`
    } else {
      fileName = slash(file.filename)
    }
    fileName = slugify(path.basename(fileName, path.extname(fileName))) + path.extname(fileName)
    log.debug(`📎 - ${fileName}`)
    try {
      let filepath = await helpers.getUniquePath(fileName, settings.folder.output)
      await writeFileAsync(filepath, file.content)
      media.url = `http://${settings.server.host}:${settings.server.port}/${path.relative(settings.folder.output, filepath)}`
    } catch (err) {
      log.error('An error occured while creating the file')
      log.error(err.message)
    }
  }

  let bucketAndToken = getBucketAndToken(mail.from.value[0].address)
  log.debug('🔐 - bucketAndToken')
  log.debug(bucketAndToken)
  if (bucketAndToken.bucket !== 'default') {
    let token = (typeof bucketAndToken.token === 'undefined') ? settings.defaultMeta.altruist.socialite.token : bucketAndToken.token
    media.meta.altruist = {
      socialite: {
        bucket: bucketAndToken.bucket,
        token: token
      },
      mandrill: {
        template: bucketAndToken.bucket
      }
    }
    media.meta.theme = bucketAndToken.bucket
  }
  return media
}

let getMailBody = (content) => {
  let body = ''
  if (content.text && content.text.length > 0) {
    body = content.text
  } else if (content.textAsHtml && content.textAsHtml.length > 0) {
    body = content.textAsHtml
  } else if (content.html && content.html.length > 0) {
    body = content.html
  }
  return body
}

let getEmailField = (metas) => {
  let emailvalue = ''
  if (metas['e-mail']) {
    emailvalue = metas['e-mail']
  } else if (metas['email']) {
    emailvalue = metas['email']
  } else if (metas['mail']) {
    emailvalue = metas['mail']
  }
  if (emailvalue.length < 1) {
    log.warn('The emailvalue is empty. Can\'t find any email in metas')
    log.warn(metas)
  }
  return emailvalue
}

mailListener.on('connected', () => {
  log.info('imapConnected')
})

mailListener.on('disconnected', () => {
  log.info('imapDisconnected')
  mailListener.start()
})

mailListener.on('error', (err) => {
  log.error('An error occured: ')
  log.error(err)
  process.exit(1)
})

mailListener.on('mail', async (mail, seqno, attributes) => {
  log.info('📩 - new mail')
  let outMedia = await mailListenerMediaToStandardMedia(mail)
  let mailBody = getMailBody(mail)
  let metas = await parseBody(mailBody)
  log.debug('metas:')
  log.debug(metas)
  if (settings.checkMetaInBody) {
    log.debug('using email from body')
    let email = getEmailField(metas)
    outMedia.meta.email = email.length > 0 ? email : outMedia.meta.email
  }
  if (settings.defaultMeta) {
    let defaultMediaMeta = JSON.parse(JSON.stringify(settings.defaultMeta))
    console.log('Media meta default: ')
    console.log(defaultMediaMeta)
    console.log('------')
    console.log('Media metas')
    console.log(outMedia.meta)
    console.log('======')
    outMedia.meta = assignment(outMedia.meta, defaultMediaMeta)
  }
  log.info(`📡 - Emit ${settings.service.spacebro.client.out.outMedia.eventName}`)
  log.info(JSON.stringify(outMedia, null, 2))
  spacebroClient.emit(settings.service.spacebro.client.out.outMedia.eventName, outMedia)
})

mailListener.start() // start listening

var app = express()
app.use(express.static(settings.folder.output))
app.listen(process.env.PORT || settings.server.port)
