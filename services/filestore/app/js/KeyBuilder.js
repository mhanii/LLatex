import settings from '@overleaf/settings'
import projectKey from '@overleaf/object-persistor/src/ProjectKey.js'

export default {
  getConvertedFolderKey,
  addCachingToKey,
  bucketFileKeyMiddleware,
  globalBlobFileKeyMiddleware,
  projectBlobFileKeyMiddleware,
  templateFileKeyMiddleware,
}

function getConvertedFolderKey(key) {
  return `${key}-converted-cache/`
}

function addCachingToKey(key, opts) {
  key = this.getConvertedFolderKey(key)

  if (opts.format && !opts.style) {
    key = `${key}format-${opts.format}`
  }
  if (opts.style && !opts.format) {
    key = `${key}style-${opts.style}`
  }
  if (opts.style && opts.format) {
    key = `${key}format-${opts.format}-style-${opts.style}`
  }

  return key
}

function bucketFileKeyMiddleware(req, res, next) {
  req.bucket = req.params.bucket
  req.key = req.params[0]
  next()
}

function globalBlobFileKeyMiddleware(req, res, next) {
  req.bucket = settings.filestore.stores.global_blobs
  const { hash } = req.params
  req.key = `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4)}`
  // history-v1's fs persistor writes blobs flat (key '/'->'_'); read them the
  // same way. No-op on s3/gcs, which ignore useSubdirectories.
  next()
}

function projectBlobFileKeyMiddleware(req, res, next) {
  req.bucket = settings.filestore.stores.project_blobs
  const { historyId, hash } = req.params
  req.key = `${projectKey.format(historyId)}/${hash.slice(0, 2)}/${hash.slice(2)}`
  // history-v1's fs persistor writes blobs flat (key '/'->'_'); read them the
  // same way. No-op on s3/gcs, which ignore useSubdirectories.
  next()
}

function templateFileKeyMiddleware(req, res, next) {
  const {
    template_id: templateId,
    format,
    version,
    sub_type: subType,
  } = req.params

  req.key = `${templateId}/v/${version}/${format}`

  if (subType) {
    req.key = `${req.key}/${subType}`
  }

  req.bucket = settings.filestore.stores.template_files
  req.version = version

  next()
}
