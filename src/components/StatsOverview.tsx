'use client'

import type { LabelStats, LabelTier } from '@/lib/types'
import { ScoreBadge } from './ScoreBadge'

interface StatsOverviewProps {
  stats: LabelStats
}

const QUALITY_TIERS: LabelTier[] = ['high-quality', 'standard', 'draft', 'likely-test']

export function StatsOverview({ stats }: StatsOverviewProps) {
  return (
    <div className='flex gap-3 overflow-x-auto pb-2 scrollbar-none'>
      {/* Total Labeled */}
      <div className='border border-border rounded-lg bg-card p-4 min-w-[140px] flex-shrink-0'>
        <p className='text-2xl font-bold text-foreground'>{stats.total}</p>
        <p className='text-[10px] uppercase tracking-wide text-muted-foreground mt-1'>total labeled</p>
      </div>

      {/* Last 24h */}
      <div className='border border-border rounded-lg bg-card p-4 min-w-[140px] flex-shrink-0'>
        <p className='text-2xl font-bold text-foreground'>{stats.last24h}</p>
        <p className='text-[10px] uppercase tracking-wide text-muted-foreground mt-1'>last 24 hours</p>
      </div>

      {/* Last 7 days */}
      <div className='border border-border rounded-lg bg-card p-4 min-w-[140px] flex-shrink-0'>
        <p className='text-2xl font-bold text-foreground'>{stats.last7d}</p>
        <p className='text-[10px] uppercase tracking-wide text-muted-foreground mt-1'>last 7 days</p>
      </div>

      {/* By Quality */}
      <div className='border border-border rounded-lg bg-card p-4 min-w-[200px] flex-shrink-0'>
        <div className='flex flex-wrap gap-1.5'>
          {QUALITY_TIERS.map(tier => (
            <span key={tier} className='flex items-center gap-1'>
              <ScoreBadge tier={tier} />
              <span className='text-[11px] font-mono text-muted-foreground'>
                {stats.byTier[tier] ?? 0}
              </span>
            </span>
          ))}
        </div>
        <p className='text-[10px] uppercase tracking-wide text-muted-foreground mt-1'>by quality tier</p>
      </div>
    </div>
  )
}
