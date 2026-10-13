import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { ADMIN_OAUTH_FLOW_COOKIE_NAME } from '@/lib/admin-constants'
import { ADMIN_ORIGIN, ADMIN_SESSION_COOKIE_SECURE } from '@/lib/config'
import { AdminOAuthNotAllowedError, beginAdminOAuthLogin, getAdminOAuthConfigurationIssue } from '@/lib/admin-oauth'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const issue = getAdminOAuthConfigurationIssue()
  if (issue || !ADMIN_ORIGIN) return loginRedirect('configuration')
  if (request.headers.get('origin') !== ADMIN_ORIGIN) {
    return NextResponse.json({ error: 'admin_origin_rejected' }, { status: 403 })
  }
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') {
    return NextResponse.json({ error: 'admin_origin_rejected' }, { status: 403 })
  }

  let identifier: string
  try {
    const form = await request.formData()
    identifier = String(form.get('identifier') ?? '').trim()
  } catch {
    return loginRedirect('invalid')
  }
  if (!identifier || identifier.length > 253 || /[\r\n\0]/.test(identifier)) {
    return loginRedirect('invalid')
  }

  const browserToken = randomBytes(32).toString('base64url')
  try {
    const authorizationUrl = await beginAdminOAuthLogin(identifier, browserToken)
    const response = NextResponse.redirect(authorizationUrl, 303)
    response.cookies.set(ADMIN_OAUTH_FLOW_COOKIE_NAME, browserToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: ADMIN_SESSION_COOKIE_SECURE,
      path: '/api/admin/oauth',
      maxAge: 600,
    })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    return loginRedirect(error instanceof AdminOAuthNotAllowedError ? 'not-allowed' : 'failed')
  }
}

function loginRedirect(reason: string): NextResponse {
  const origin = ADMIN_ORIGIN ?? 'http://localhost'
  return NextResponse.redirect(new URL(`/admin?login=${reason}`, origin), 303)
}
