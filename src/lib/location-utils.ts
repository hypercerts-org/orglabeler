export type LocationValidationResult = {
  valid: boolean
  reason?: string
}

type StrongRefLike = {
  uri?: unknown
  cid?: unknown
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function collectionFromAtUri(uri: string): string {
  if (!uri.startsWith('at://')) return ''

  const remainder = uri.slice(5)
  const firstSlash = remainder.indexOf('/')
  if (firstSlash === -1) return ''

  const afterDid = remainder.slice(firstSlash + 1)
  const secondSlash = afterDid.indexOf('/')
  if (secondSlash === -1) return ''

  return afterDid.slice(0, secondSlash)
}

export function validateOrganizationLocationRef(location: unknown): LocationValidationResult {
  if (!location || typeof location !== 'object') {
    return { valid: false, reason: 'missing_strong_ref' }
  }

  const ref = location as StrongRefLike
  const uri = normalizeText(ref.uri)
  if (!uri) {
    return { valid: false, reason: 'missing_uri' }
  }

  const cid = normalizeText(ref.cid)
  if (!cid) {
    return { valid: false, reason: 'missing_cid' }
  }

  if (collectionFromAtUri(uri) !== 'app.certified.location') {
    return { valid: false, reason: 'wrong_collection' }
  }

  return { valid: true }
}
