'use client'

import { useState } from 'react'
import type { ActivityLogEntry, ScoreBreakdown as ScoreBreakdownType, LabelTier } from '@/lib/types'
import { ORGANIZATION_COLLECTION } from '@/lib/config'
import { buildRecordUrl } from '@/lib/record-url'
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

const HF_POSITIVE_LABEL = 'well-formed actor profile'

export function ScoreCard({ entry, defaultExpanded = false }: ScoreCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  let breakdown: ScoreBreakdownType = {} as ScoreBreakdownType
  let testSignals: string[] = []
  try {
    breakdown = typeof entry.breakdown === 'string' ? JSON.parse(entry.breakdown) : entry.breakdown
  } catch { /* use empty */ }
  try {
    testSignals = typeof entry.testSignals === 'string' ? JSON.parse(entry.testSignals) : entry.testSignals
  } catch { /* use empty */ }

  const shortDid = entry.did.replace('did:plc:', '').slice(0, 12) + '…'
  const recordUrl = buildRecordUrl(entry.did, ORGANIZATION_COLLECTION, entry.rkey)
  const barColor = TIER_BAR_COLORS[entry.tier]
  const relativeTime = getRelativeTime(entry.labeledAt)

  return (
    <div
      role='button'
      tabIndex={0}
      aria-expanded={expanded}
      className='border border-border rounded-lg overflow-hidden bg-card transition-colors hover:bg-accent/30 cursor-pointer'
      onClick={() => setExpanded(prev => !prev)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(prev => !prev) } }}
    >
      {/* Header row */}
      <div className='flex items-center justify-between px-3 py-2.5'>
        <a
          href={recordUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline'
          onClick={e => e.stopPropagation()}
        >
          <span className='text-muted-foreground/50'>did:plc:</span>{shortDid}
        </a>
        <span className='text-[10px] text-muted-foreground/60'>{relativeTime}</span>
      </div>

      {/* Display name row */}
      <div className='px-3 pb-1'>
        <a
          href={recordUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='text-sm font-medium text-foreground truncate hover:text-primary hover:underline inline-flex items-center gap-1 max-w-full'
          onClick={e => e.stopPropagation()}
        >
          <span className='truncate'>{entry.displayName}</span>
          <span className='text-muted-foreground shrink-0'>↗</span>
        </a>
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

      {/* HF classification badge */}
      {entry.hfLabel != null && (
        <div className='px-3 pb-2'>
          <span
            className='inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full'
            style={{
              backgroundColor: entry.hfLabel === HF_POSITIVE_LABEL
                ? 'oklch(0.8 0.15 145 / 0.2)'
                : 'oklch(0.8 0.15 80 / 0.2)',
              color: entry.hfLabel === HF_POSITIVE_LABEL
                ? 'oklch(0.55 0.15 145)'
                : 'oklch(0.55 0.15 80)',
            }}
          >
            🤖 HF: {entry.hfLabel} ({entry.hfScore != null ? `${Math.round(entry.hfScore * 100)}%` : '—'})
          </span>
        </div>
      )}

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
               <ScoreBreakdown breakdown={breakdown} validationNotes={entry.validationNotes} testSignals={testSignals} />
              )}
            </div>
          </div>
      </div>
    </div>
  )
}
