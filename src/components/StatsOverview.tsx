'use client'

import type { LabelStats, RuntimeLabelTier } from '@/lib/types'
import { TierBadge } from './TierBadge'

interface StatsOverviewProps {
  stats: LabelStats
}

const QUALITY_TIERS: RuntimeLabelTier[] = ['likely-test', 'standard', 'high-quality']

export function StatsOverview({ stats }: StatsOverviewProps) {
  return (
    <div className='flex gap-3 overflow-x-auto pb-2 scrollbar-none'>
      {/* Total organizations */}
      <div className='border border-border rounded-lg bg-card p-4 min-w-[140px] flex-shrink-0'>
        <p className='text-2xl font-bold text-foreground'>{stats.total}</p>
        <p className='text-[10px] uppercase tracking-wide text-muted-foreground mt-1'>organizations monitored</p>
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
              <TierBadge tier={tier} />
              <span className='text-[11px] font-mono text-muted-foreground'>
                {stats.byTier[tier] ?? 0}
              </span>
            </span>
          ))}
        </div>
        <p className='text-[10px] uppercase tracking-wide text-muted-foreground mt-1'>by quality tier</p>
      </div>

      {/* Assessment status */}
      <div className='border border-border rounded-lg bg-card p-4 min-w-[220px] flex-shrink-0'>
        <div className='flex flex-wrap gap-x-3 gap-y-1 text-xs font-mono'>
          <span>{stats.byAssessmentStatus.uncertain} uncertain</span>
          <span>{stats.byAssessmentStatus['awaiting-configuration']} awaiting key</span>
          <span>{stats.staleLabels} stale labels</span>
        </div>
        <p className='text-[10px] uppercase tracking-wide text-muted-foreground mt-2'>assessment status</p>
      </div>
    </div>
  )
}
