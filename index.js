const SpacebroClient = require('spacebro-client').SpacebroClient
const standardSettings = require('standard-settings')
const MailListener = require('mail-listener-fixed')
const jsdom = require('jsdom')
const striptags = require('striptags')
const { JSDOM } = jsdom
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
var settings = standardSettings.getSettings()

var spacebroClient = new SpacebroClient()
_.set(settings.service.mail, 'attachmentOptions.directory', settings.folder.output + '/')
settings.service.mail.debug = console.log
var mailListener = new MailListener(settings.service.mail)
mkdirp(settings.folder.output)
mkdirp(settings.folder.tmp)

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
  let params = {}
  if (htmlText) {
    const dom = new JSDOM(htmlText)
    let body = dom.window.document.querySelector('body').textContent.trim()
    body = striptags(body)
    let lines = splitLines(body)
    lines.forEach(el => {
      let section = el.split(':')
      if (section.length === 2) {
        params[section[0].toLowerCase().trim()] = section[1].trim()
      }
    })
  }
  return params
}

let mailListenerMediaToStandardMedia = async (mail) => {
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
    let file = mail.attachments[0]
    let filepath = await helpers.getUniquePath(file.filename, settings.folder.output)
    await writeFileAsync(filepath, file.content)
    media.url = `http://${settings.server.host}:${settings.server.port}/${path.relative(settings.folder.output, filepath)}`
  }

  let bucketAndToken = getBucketAndToken(mail.from.value[0].address)
  if (bucketAndToken.bucket) {
    media.meta.altruist = {
      socialite: {
        bucket: bucketAndToken.bucket,
        token: bucketAndToken.token
      },
      mandrill: {
        template: bucketAndToken.bucket
      }
    }
    media.meta.theme = bucketAndToken.bucket
  }

  return media
}

mailListener.on('connected', () => {
  console.log('imapConnected')
})

mailListener.on('disconnected', () => {
  console.log('imapDisconnected')
  mailListener.start()
})

mailListener.on('error', (err) => {
  console.error('An error occured: ')
  console.error(err)
  process.exit(1)
})

mailListener.on('mail', async (mail, seqno, attributes) => {
  let outMedia = await mailListenerMediaToStandardMedia(mail)
  let metas = await parseHeadooBody(mail.html)
  console.log(metas)
  spacebroClient.emit(settings.service.spacebro.client.out.outMedia.eventName, outMedia)
  console.log('emit ' + JSON.stringify(outMedia, null, 2))
})

mailListener.start() // start listening

var app = express()
app.use(express.static(settings.folder.output))
app.listen(process.env.PORT || settings.server.port)
