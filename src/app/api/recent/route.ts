import { NextResponse } from 'next/server'
import { getRecentActivities, getActivitiesByTier, getTotalCount } from '@/lib/db'
import type { LabelTier, ActivityLogEntry } from '@/lib/types'

const VALID_TIERS: LabelTier[] = ['pending', 'high-quality', 'standard', 'draft', 'likely-test']

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limit = Math.min(Number(searchParams.get('limit') ?? 20), 100)
  const offset = Number(searchParams.get('offset') ?? 0)
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
  const parsed = activities.map(a => ({
    ...a,
    breakdown: JSON.parse(a.breakdown),
    testSignals: JSON.parse(a.testSignals),
  }))

  return NextResponse.json({ activities: parsed, total })
}
