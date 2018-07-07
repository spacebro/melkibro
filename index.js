const SpacebroClient = require('spacebro-client').SpacebroClient
var standardSettings = require('standard-settings')
var MailListener = require('mail-listener-fixed')
// const download = require('download')
const express = require('express')
const path = require('path')
const mkdirp = require('mkdirp')
const fs = require('fs-extra')
const _ = require('lodash')
var settings = standardSettings.getSettings()

var spacebroClient = new SpacebroClient()
_.set(settings.service.mail, 'attachmentOptions.directory', settings.folder.output + '/')
settings.service.mail.debug = console.log
var mailListener = new MailListener(settings.service.mail)
mkdirp(settings.folder.output)
mkdirp(settings.folder.tmp)

mailListener.start() // start listening

mailListener.on('connected', () => {
  console.log('imapConnected')
})

mailListener.on('disconnected', () => {
  console.log('imapDisconnected')
  mailListener.start()
})

mailListener.on('error', (err) => {
  console.log(err)
})

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

let mailListenerMediaToStandardMedia = (mail) => {
  let mailObject = JSON.parse(JSON.stringify(mail))
  delete mailObject.attachments
  delete mailObject.eml
  let media = {
    meta: {
      email: mail.to.text,
      melkibro: mailObject
    }
  }

  if (mail.attachments) {
    let file = mail.attachments[0]
    fs.moveSync(file.path, path.join(settings.folder.output, file.filename), { overwrite: true })
    media.url = `http://${settings.server.host}:${settings.server.port}/${file.filename}`
  }

  let bucketAndToken = getBucketAndToken(mail.from.value[0].address)
  if (bucketAndToken.bucket) {
    media.meta = {
      altruist: {
        socialite: {
          bucket: bucketAndToken.bucket,
          token: bucketAndToken.token
        },
        mandrill: {
          template: bucketAndToken.bucket
        }
      },
      theme: bucketAndToken.bucket
    }
  }

  return media
}

mailListener.on('mail', (mail, seqno, attributes) => {
  let outMedia = mailListenerMediaToStandardMedia(mail)
  spacebroClient.emit(settings.service.spacebro.client.out.outMedia.eventName, outMedia)
  console.log('emit ' + JSON.stringify(outMedia, null, 2))
})

var app = express()
app.use(express.static(settings.folder.output))
app.listen(process.env.PORT || settings.server.port)
