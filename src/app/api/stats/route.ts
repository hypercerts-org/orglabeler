import { NextResponse } from 'next/server'
import { getStats } from '@/lib/db'

export async function GET() {
  try {
    const stats = getStats()
    return NextResponse.json({ stats })
  } catch (err) {
    console.error('API /api/stats error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
