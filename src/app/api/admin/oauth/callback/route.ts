import { NextResponse } from 'next/server'
import { ADMIN_OAUTH_FLOW_COOKIE_NAME } from '@/lib/admin-constants'
import { ADMIN_ORIGIN, ADMIN_SESSION_COOKIE_SECURE } from '@/lib/config'
import { isAdminDidAllowed, issueAdminSessionForVerifiedDid, serializeAdminSessionCookies } from '@/lib/admin-auth'
import {
  getAdminOAuthConfigurationIssue,
  inspectAdminOAuthCallback,
  verifyAdminOAuthCallback,
  withAdminOAuthCallbackLock,
} from '@/lib/admin-oauth'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  if (getAdminOAuthConfigurationIssue() || !ADMIN_ORIGIN) return finish('configuration')

  const params = new URL(request.url).searchParams
  if (['state', 'code', 'error', 'iss'].some(name => params.getAll(name).length > 1)) {
    return finish('failed')
  }

  const state = params.get('state') ?? ''
  const browserToken = readCookie(request.headers.get('cookie'), ADMIN_OAUTH_FLOW_COOKIE_NAME)
  if (!browserToken) return finish('failed')
  const pending = inspectAdminOAuthCallback(state, browserToken)
  if (!pending) return finish('failed')

  try {
    return await withAdminOAuthCallbackLock(async () => {
      const paramsHaveError = params.has('error')
      if (paramsHaveError === params.has('code')) return finish('failed')

      const verified = await verifyAdminOAuthCallback(params, pending)
      try {
        if (!isAdminDidAllowed(verified.did)) return finish('not-allowed', true)

        const credentials = issueAdminSessionForVerifiedDid(verified.did)
        if (!credentials) return finish('not-allowed', true)

        const response = NextResponse.redirect(new URL('/admin', ADMIN_ORIGIN!), 303)
        for (const cookie of serializeAdminSessionCookies(credentials)) {
          response.headers.append('Set-Cookie', cookie)
        }
        clearFlowCookie(response)
        response.headers.set('Cache-Control', 'no-store')
        return response
      } finally {
        try {
          await verified.revoke()
        } catch {
          // OAuth credentials are never retained locally, even if remote revocation fails.
        }
      }
    })
  } catch {
    return finish('failed', true)
  }
}

function finish(reason: string, clearMatchedFlow = false): NextResponse {
  const origin = ADMIN_ORIGIN ?? 'http://localhost'
  const response = NextResponse.redirect(new URL(`/admin?login=${reason}`, origin), 303)
  if (clearMatchedFlow) clearFlowCookie(response)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function clearFlowCookie(response: NextResponse): void {
  const secure = ADMIN_SESSION_COOKIE_SECURE ? '; Secure' : ''
  response.headers.append(
    'Set-Cookie',
    `${ADMIN_OAUTH_FLOW_COOKIE_NAME}=; Path=/api/admin/oauth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  )
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  const values = header.split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`))
  if (values.length !== 1) return null
  return values[0]!.slice(name.length + 1)
}
