'use client'

import type { LabelStats, LabelTier } from '@/lib/types'
import { ScoreBadge } from './ScoreBadge'

interface StatsOverviewProps {
  stats: LabelStats
}

const QUALITY_TIERS: LabelTier[] = ['pending', 'high-quality', 'standard', 'draft', 'likely-test']

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

      {/* HF Classification Coverage */}
      {stats.hfCoverage !== undefined && (
        <div className='border border-border rounded-lg bg-card p-4 min-w-[200px] flex-shrink-0'>
          <div className='flex items-baseline gap-2'>
            <p className='text-2xl font-bold text-foreground'>
              {stats.hfCoverage.classified}
            </p>
            <p className='text-sm text-muted-foreground'>
              / {stats.hfCoverage.total}
            </p>
          </div>
          {/* Progress bar */}
          <div className='mt-2 h-1.5 rounded-full bg-secondary overflow-hidden'>
            <div
              className='h-full rounded-full transition-all duration-500'
              style={{
                width: `${stats.hfCoverage.total > 0 ? (stats.hfCoverage.classified / stats.hfCoverage.total * 100) : 0}%`,
                backgroundColor: stats.hfCoverage.classified === stats.hfCoverage.total
                  ? 'oklch(0.8 0.15 145)'   // green when complete
                  : 'oklch(0.75 0.15 260)', // brand purple when in-progress
              }}
            />
          </div>
          <p className='text-[10px] uppercase tracking-wide text-muted-foreground mt-1'>
            🤖 hf classified
          </p>
        </div>
      )}
    </div>
  )
}
