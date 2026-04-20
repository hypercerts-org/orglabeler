import type {
  ProfileFallbackMedia,
  ProfileFallbackProfile,
  ProfileFallbackResult,
} from './types'

type UnknownProfilePayload = Record<string, unknown>

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeMedia(
  value: unknown,
  fieldName: 'avatar' | 'banner',
  validationNotes: string[],
): ProfileFallbackMedia | null {
  if (value == null) return null

  if (!isPlainObject(value)) {
    validationNotes.push(`${fieldName} was dropped because it is not an object`)
    return null
  }

  const keys = Object.keys(value)
  const type = normalizeText(value.$type)

  if (typeof value.uri === 'string') {
    const uri = value.uri.trim()
    if (!uri) {
      validationNotes.push(`${fieldName} was dropped because uri was empty`)
      return null
    }

    const allowedKeys = new Set(['$type', 'uri'])
    if (keys.some(key => !allowedKeys.has(key))) {
      validationNotes.push(`${fieldName} was dropped because it contains unexpected fields`)
      return null
    }

    return type ? { $type: type, uri } : { uri }
  }

  if (isPlainObject(value.image)) {
    if (Object.keys(value.image).length === 0) {
      validationNotes.push(`${fieldName} was dropped because image was empty`)
      return null
    }

    const allowedKeys = new Set(['$type', 'image'])
    if (keys.some(key => !allowedKeys.has(key))) {
      validationNotes.push(`${fieldName} was dropped because it contains unexpected fields`)
      return null
    }

    return type ? { $type: type, image: { ...value.image } } : { image: { ...value.image } }
  }

  validationNotes.push(`${fieldName} was dropped because it does not match the expected media shape`)
  return null
}

function sanitizeProfilePayload(payload: UnknownProfilePayload, validationNotes: string[]): ProfileFallbackProfile {
  return {
    displayName: normalizeText(payload.displayName),
    description: normalizeText(payload.description),
    website: normalizeText(payload.website),
    createdAt: normalizeText(payload.createdAt),
    avatar: sanitizeMedia(payload.avatar, 'avatar', validationNotes),
    banner: sanitizeMedia(payload.banner, 'banner', validationNotes),
  }
}

export function buildProfileFallback(payload: unknown): ProfileFallbackResult {
  if (!isPlainObject(payload)) {
    return {
      mode: 'unusable',
      validationNotes: ['Profile payload is not an object'],
    }
  }

  const validationNotes: string[] = []
  const profile = sanitizeProfilePayload(payload, validationNotes)

  if (
    !profile.displayName &&
    !profile.description &&
    !profile.website &&
    !profile.createdAt &&
    !profile.avatar &&
    !profile.banner
  ) {
    validationNotes.push('No usable profile fields survived fallback')

    return {
      mode: 'unusable',
      validationNotes,
    }
  }

  return {
    mode: 'fallback',
    profile,
    validationNotes,
  }
}

export const salvageProfileFallback = buildProfileFallback
