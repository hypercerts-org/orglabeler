import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_CSRF_HEADER_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from './admin-constants'
import {
  ADMIN_DIDS,
  ADMIN_DIDS_CONFIG,
  ADMIN_ORIGIN,
  ADMIN_SESSION_COOKIE_SECURE,
  ADMIN_SESSION_TTL_MS,
} from './config'
import {
  deleteAdminSession,
  getAdminSessionByTokenHash,
  insertAdminSession,
  type AdminSessionRecord,
} from './db'

export interface AdminSessionCredentials {
  did: string
  sessionToken: string
  csrfToken: string
  expiresAt: string
}

export interface AdminPageSession {
  did: string
  csrfToken: string
}

export type AdminAuthorization =
  | { ok: true; session: Pick<AdminSessionRecord, 'did' | 'expiresAt'> }
  | { ok: false; status: 401 | 403 | 503; code: 'admin_auth_required' | 'admin_origin_rejected' | 'admin_csrf_rejected' | 'admin_not_configured' }

/** Call only after the official OAuth client has verified the authenticated account DID. */
export function issueAdminSessionForVerifiedDid(did: string): AdminSessionCredentials | null {
  if (!isAdminDidAllowed(did) || !ADMIN_ORIGIN) return null

  const sessionToken = randomBytes(32).toString('base64url')
  const csrfToken = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString()
  insertAdminSession({
    tokenHash: sha256(sessionToken),
    did,
    csrfHash: sha256(csrfToken),
    expiresAt,
  })

  return { did, sessionToken, csrfToken, expiresAt }
}

export function serializeAdminSessionCookies(credentials: AdminSessionCredentials): string[] {
  const maxAge = Math.max(0, Math.floor((Date.parse(credentials.expiresAt) - Date.now()) / 1000))
  const secure = ADMIN_SESSION_COOKIE_SECURE ? '; Secure' : ''
  return [
    `${ADMIN_SESSION_COOKIE_NAME}=${credentials.sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
    // Lax lets the top-level OAuth redirect carry this cookie so the admin page can render the token.
    // Mutations still require exact-origin and CSRF header/hash checks in authorizeAdminRequest.
    `${ADMIN_CSRF_COOKIE_NAME}=${credentials.csrfToken}; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  ]
}

export function clearAdminSessionCookies(): string[] {
  const secure = ADMIN_SESSION_COOKIE_SECURE ? '; Secure' : ''
  return [
    `${ADMIN_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `${ADMIN_CSRF_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0${secure}`,
  ]
}

export function revokeAdminSessionFromToken(token: string): void {
  if (isOpaqueToken(token)) deleteAdminSession(sha256(token))
}

export function getAdminSessionFromToken(token: string): AdminSessionRecord | null {
  if (!isOpaqueToken(token)) return null
  const tokenHash = sha256(token)
  const session = getAdminSessionByTokenHash(tokenHash)
  if (!session) return null

  const expiresAt = Date.parse(session.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || !isAdminDidAllowed(session.did)) {
    deleteAdminSession(tokenHash)
    return null
  }

  return session
}

export function getAdminPageSession(cookieHeader: string | null): AdminPageSession | null {
  const sessionToken = readCookie(cookieHeader, ADMIN_SESSION_COOKIE_NAME)
  const csrfToken = readCookie(cookieHeader, ADMIN_CSRF_COOKIE_NAME)
  if (!sessionToken || !csrfToken) return null

  const session = getAdminSessionFromToken(sessionToken)
  if (!session || !constantTimeEqual(sha256(csrfToken), session.csrfHash)) return null
  return { did: session.did, csrfToken }
}

export function isAdminDidAllowed(did: string): boolean {
  return ADMIN_DIDS_CONFIG.error === null && ADMIN_DIDS.includes(did)
}

export function authorizeAdminRequest(
  request: Request,
  options: { mutation?: boolean } = {},
): AdminAuthorization {
  if (ADMIN_DIDS_CONFIG.error || !ADMIN_ORIGIN) {
    return { ok: false, status: 503, code: 'admin_not_configured' }
  }

  if (options.mutation) {
    if (request.headers.get('origin') !== ADMIN_ORIGIN) {
      return { ok: false, status: 403, code: 'admin_origin_rejected' }
    }
    const fetchSite = request.headers.get('sec-fetch-site')
    if (fetchSite && fetchSite !== 'same-origin') {
      return { ok: false, status: 403, code: 'admin_origin_rejected' }
    }
  }

  const token = readCookie(request.headers.get('cookie'), ADMIN_SESSION_COOKIE_NAME)
  if (!token) return { ok: false, status: 401, code: 'admin_auth_required' }
  const session = getAdminSessionFromToken(token)
  if (!session) return { ok: false, status: 401, code: 'admin_auth_required' }

  if (options.mutation) {
    const cookieToken = readCookie(request.headers.get('cookie'), ADMIN_CSRF_COOKIE_NAME)
    const headerToken = request.headers.get(ADMIN_CSRF_HEADER_NAME)
    if (
      !cookieToken ||
      !headerToken ||
      !isOpaqueToken(cookieToken) ||
      !isOpaqueToken(headerToken) ||
      !constantTimeEqual(cookieToken, headerToken) ||
      !constantTimeEqual(sha256(headerToken), session.csrfHash)
    ) {
      return { ok: false, status: 403, code: 'admin_csrf_rejected' }
    }
  }

  return { ok: true, session: { did: session.did, expiresAt: session.expiresAt } }
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  const values = header.split(';')
    .map(part => part.trim())
    .filter(part => part.startsWith(`${name}=`))
  if (values.length !== 1) return null
  return values[0]!.slice(name.length + 1)
}

function isOpaqueToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}
