import { NextResponse } from 'next/server'
import { getAdminOAuthClient } from '@/lib/admin-oauth'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const client = await getAdminOAuthClient()
    return NextResponse.json(client.clientMetadata, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'admin_oauth_not_configured' }, { status: 503 })
  }
}
