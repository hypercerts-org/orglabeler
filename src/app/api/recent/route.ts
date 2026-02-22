import { NextResponse } from 'next/server'
import { getRecentActivities, getActivitiesByTier, getTotalCount } from '@/lib/db'
import type { LabelTier, ActivityLogEntry } from '@/lib/types'

const VALID_TIERS: LabelTier[] = ['pending', 'high-quality', 'standard', 'draft', 'likely-test']

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)

    const rawLimit = Number(searchParams.get('limit') ?? 20)
    const rawOffset = Number(searchParams.get('offset') ?? 0)
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 20
    const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0

    const tierParam = searchParams.get('tier') as LabelTier | 'all' | null

    // Validate tier — if invalid (not one of the 4 tiers or "all"), treat as "all"
    const isValidTier = tierParam && tierParam !== 'all' && VALID_TIERS.includes(tierParam as LabelTier)
    const tier = isValidTier ? (tierParam as LabelTier) : null

    let activities: ActivityLogEntry[]
    let total: number

    if (tier) {
      activities = getActivitiesByTier(tier, limit, offset)
      total = getTotalCount(tier)
    } else {
      activities = getRecentActivities(limit, offset)
      total = getTotalCount()
    }

    // Parse JSON strings in each entry before returning
    const parsed = activities.map(a => {
      let breakdown = {}
      let testSignals: string[] = []
      try { breakdown = JSON.parse(a.breakdown) } catch { /* use empty */ }
      try { testSignals = JSON.parse(a.testSignals) } catch { /* use empty */ }
      return { ...a, breakdown, testSignals, hfLabel: a.hfLabel ?? null, hfScore: a.hfScore ?? null }
    })

    return NextResponse.json({ activities: parsed, total })
  } catch (err) {
    console.error('API /api/recent error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
