const uniquefilename = require('uniquefilename')
const download = require('download')
const path = require('path')
const util = require('util')
const format = require('date-fns/format')
const mkdirp = util.promisify(require('mkdirp'))

const getUniquePath = async function (filename, folder) {
  let now = new Date()
  let relative = path.join(format(now, 'yyyy'), format(now, 'MM'), format(now, 'dd'))
  folder = path.join(folder, relative)
  await mkdirp(folder)
  let filepath = path.join(folder, filename)
  filepath = await uniquefilename.get(filepath)
  return filepath
}

// returns filepath
const downloadUnique = async function (url, folder) {
  let filepath = await getUniquePath(path.basename(url), folder)
  try {
    await download(url, path.dirname(filepath), {filename: path.basename(filepath)})
  } catch (e) {
    console.log(e)
    throw e
  }
  return filepath
}

module.exports = {
  getUniquePath,
  downloadUnique
}
