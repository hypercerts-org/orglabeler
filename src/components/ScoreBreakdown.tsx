'use client'

import type { ScoreBreakdown as ScoreBreakdownType } from '@/lib/types'

interface ScoreBreakdownProps {
  breakdown: ScoreBreakdownType
  testSignals: string[]
}

const CRITERIA: Array<{ label: string; field: keyof ScoreBreakdownType; max: number }> = [
  { label: 'Title', field: 'titleQuality', max: 15 },
  { label: 'Summary', field: 'shortDescQuality', max: 15 },
  { label: 'Description', field: 'descriptionQuality', max: 20 },
  { label: 'Image', field: 'hasImage', max: 10 },
  { label: 'Work Scope', field: 'hasWorkScope', max: 10 },
  { label: 'Contributors', field: 'contributorQuality', max: 15 },
  { label: 'Locations', field: 'hasLocations', max: 5 },
  { label: 'Date Range', field: 'hasDateRange', max: 5 },
  { label: 'Rights', field: 'hasRights', max: 5 },
]

function getBarColor(ratio: number): string {
  if (ratio >= 0.7) return 'bg-emerald-500/70'
  if (ratio >= 0.4) return 'bg-blue-500/70'
  if (ratio >= 0.15) return 'bg-amber-500/70'
  return 'bg-rose-500/70'
}

export function ScoreBreakdown({ breakdown, testSignals }: ScoreBreakdownProps) {
  return (
    <div>
      {CRITERIA.map(({ label, field, max }) => {
        const value = breakdown[field]
        const ratio = max > 0 ? value / max : 0
        const widthPct = Math.round(ratio * 100)
        const barColor = getBarColor(ratio)

        return (
          <div key={field} className='flex items-center gap-3 py-1'>
            <span className='text-[11px] text-muted-foreground w-28 shrink-0'>{label}</span>
            <div className='flex-1 h-1 rounded-full bg-secondary overflow-hidden'>
              <div
                className={`h-full rounded-full ${barColor}`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className='text-[11px] text-muted-foreground font-mono w-10 text-right'>
              {value}/{max}
            </span>
          </div>
        )
      })}

      {testSignals.length > 0 && (
        <div className='mt-2 p-2 rounded-md bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20'>
          <div className='flex items-center gap-1.5 mb-1'>
            <svg
              width='12'
              height='12'
              viewBox='0 0 12 12'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
              className='shrink-0'
            >
              <path
                d='M6 1L11 10H1L6 1Z'
                stroke='currentColor'
                strokeWidth='1.2'
                strokeLinejoin='round'
                className='text-rose-700 dark:text-rose-400'
              />
              <path
                d='M6 5V7'
                stroke='currentColor'
                strokeWidth='1.2'
                strokeLinecap='round'
                className='text-rose-700 dark:text-rose-400'
              />
              <circle cx='6' cy='8.5' r='0.5' fill='currentColor' className='text-rose-700 dark:text-rose-400' />
            </svg>
            <span className='text-[11px] font-medium text-rose-700 dark:text-rose-400'>
              Test signals detected
            </span>
          </div>
          {testSignals.map((signal, i) => (
            <div key={i} className='text-[10px] text-rose-600 dark:text-rose-400/80 pl-4'>
              • {signal}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
