import { NextResponse } from 'next/server'
import { getAssessmentFeedPage } from '@/lib/db'
import type { RuntimeLabelTier } from '@/lib/types'

const VALID_TIERS: RuntimeLabelTier[] = ['likely-test', 'standard', 'high-quality']

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)

    const rawLimit = Number(searchParams.get('limit') ?? 20)
    const rawOffset = Number(searchParams.get('offset') ?? 0)
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.floor(rawLimit), 100)) : 20
    const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0

    const tierParam = searchParams.get('tier')
    const tier = tierParam && VALID_TIERS.includes(tierParam as RuntimeLabelTier)
      ? tierParam as RuntimeLabelTier
      : null
    const query = searchParams.get('q')?.trim() || null
    const page = getAssessmentFeedPage({ limit, offset, tier, query })

    return NextResponse.json({ activities: page.assessments, total: page.total })
  } catch (err) {
    console.error('API /api/recent error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
