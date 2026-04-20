'use client'

import { COMPLETENESS_WEIGHTS } from '@/lib/constants'
import type { ScoreBreakdown as ScoreBreakdownType } from '@/lib/types'

interface ScoreBreakdownProps {
  breakdown: ScoreBreakdownType
  testSignals: string[]
}

const CRITERIA: Array<{ label: string; field: keyof ScoreBreakdownType; max: number }> = [
  { label: 'Display name', field: 'displayName', max: COMPLETENESS_WEIGHTS.displayName },
  { label: 'Description', field: 'description', max: COMPLETENESS_WEIGHTS.description },
  { label: 'Organization type', field: 'organizationType', max: COMPLETENESS_WEIGHTS.organizationType },
  { label: 'Profile website present', field: 'websitePresent', max: COMPLETENESS_WEIGHTS.websitePresent },
  { label: 'Profile website resolves', field: 'websiteResolves', max: COMPLETENESS_WEIGHTS.websiteResolves },
  { label: 'Profile website matches name', field: 'websiteMatchesName', max: COMPLETENESS_WEIGHTS.websiteMatchesName },
  { label: 'Organization URLs (small bonus)', field: 'organizationUrlsPresent', max: COMPLETENESS_WEIGHTS.organizationUrlsPresent },
  { label: 'Organization URLs resolve', field: 'organizationUrlsResolve', max: COMPLETENESS_WEIGHTS.organizationUrlsResolve },
  { label: 'Location valid', field: 'locationValid', max: COMPLETENESS_WEIGHTS.locationValid },
  { label: 'Founded date valid', field: 'foundedDateValid', max: COMPLETENESS_WEIGHTS.foundedDateValid },
  { label: 'Founded date age bonus', field: 'foundedDateAge', max: COMPLETENESS_WEIGHTS.foundedDateAge },
  { label: 'Avatar', field: 'avatar', max: COMPLETENESS_WEIGHTS.avatar },
  { label: 'Banner', field: 'banner', max: COMPLETENESS_WEIGHTS.banner },
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
      <p className='mb-2 text-[11px] text-muted-foreground'>
        Authenticity gate failures are checked before completeness scoring.
      </p>

      {CRITERIA.map(({ label, field, max }) => {
        const value = breakdown[field] ?? 0
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
              Authenticity gate failed
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
