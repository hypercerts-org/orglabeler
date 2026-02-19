'use client'

import { useState } from 'react'
import type { ActivityLogEntry, ScoreBreakdown as ScoreBreakdownType, LabelTier } from '@/lib/types'
import { ScoreBadge } from './ScoreBadge'
import { ScoreBreakdown } from './ScoreBreakdown'

interface ScoreCardProps {
  entry: ActivityLogEntry
  defaultExpanded?: boolean
}

function getRelativeTime(isoTimestamp: string): string {
  const now = Date.now()
  const then = new Date(isoTimestamp).getTime()
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffMin < 1) return '<1m ago'
  if (diffHour < 1) return `${diffMin}m ago`
  if (diffDay < 1) return `${diffHour}h ago`
  return `${diffDay}d ago`
}

const TIER_BAR_COLORS: Record<LabelTier, string> = {
  'pending': 'bg-violet-500/60',
  'high-quality': 'bg-emerald-500/60',
  'standard': 'bg-blue-500/60',
  'draft': 'bg-amber-500/60',
  'likely-test': 'bg-rose-500/60',
}

export function ScoreCard({ entry, defaultExpanded = false }: ScoreCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const breakdown: ScoreBreakdownType = typeof entry.breakdown === 'string'
    ? JSON.parse(entry.breakdown)
    : entry.breakdown

  const testSignals: string[] = typeof entry.testSignals === 'string'
    ? JSON.parse(entry.testSignals)
    : entry.testSignals

  const truncatedDid = entry.did.slice(0, 20)
  const barColor = TIER_BAR_COLORS[entry.tier]
  const relativeTime = getRelativeTime(entry.labeledAt)

  return (
    <div
      className='border border-border rounded-lg overflow-hidden bg-card transition-colors hover:bg-accent/30 cursor-pointer'
      onClick={() => setExpanded(prev => !prev)}
    >
      {/* Header row */}
      <div className='flex items-center justify-between px-3 py-2.5'>
        <span className='font-mono text-[11px] text-muted-foreground'>{truncatedDid}</span>
        <span className='text-[10px] text-muted-foreground/60'>{relativeTime}</span>
      </div>

      {/* Title row */}
      <div className='px-3 pb-1'>
        <p className='text-sm font-medium text-foreground truncate'>{entry.title}</p>
      </div>

      {/* Score bar + badge row */}
      <div className='flex items-center gap-2 px-3 pb-2.5'>
        <div className='flex-1 h-1.5 rounded-full bg-secondary overflow-hidden'>
          {entry.tier === 'pending' ? (
            <div className='h-full w-full bg-violet-500/40 animate-pulse rounded-full' />
          ) : (
            <div
              className={`h-full rounded-full ${barColor}`}
              style={{ width: `${entry.score}%` }}
            />
          )}
        </div>
        <ScoreBadge tier={entry.tier} score={entry.tier === 'pending' ? undefined : entry.score} />
      </div>

      {/* Expandable breakdown */}
      <div
        className='grid transition-[grid-template-rows] duration-200'
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className='overflow-hidden'>
          <div className='px-3 py-2.5 border-t border-border/50'>
            {entry.tier === 'pending' ? (
              <p className='text-xs text-muted-foreground italic animate-pulse'>Evaluating record quality...</p>
            ) : (
              <ScoreBreakdown breakdown={breakdown} testSignals={testSignals} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
