import { NextResponse } from 'next/server'
import { ADMIN_SESSION_COOKIE_NAME } from '@/lib/admin-constants'
import { clearAdminSessionCookies, authorizeAdminRequest, revokeAdminSessionFromToken } from '@/lib/admin-auth'
import { ADMIN_ORIGIN } from '@/lib/config'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const authorization = authorizeAdminRequest(request, { mutation: true })
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.code }, { status: authorization.status })
  }

  const token = readCookie(request.headers.get('cookie'), ADMIN_SESSION_COOKIE_NAME)
  if (token) revokeAdminSessionFromToken(token)

  const response = NextResponse.redirect(new URL('/admin', ADMIN_ORIGIN!), 303)
  for (const cookie of clearAdminSessionCookies()) response.headers.append('Set-Cookie', cookie)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  const values = header.split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`))
  if (values.length !== 1) return null
  return values[0]!.slice(name.length + 1)
}
