'use client'

import { useState } from 'react'
import type { AssessmentFeedEntry } from '@/lib/types'
import { ORGANIZATION_COLLECTION } from '@/lib/config'
import { buildRecordUrl } from '@/lib/record-url'
import { TierBadge } from './TierBadge'

interface AssessmentCardProps {
  entry: AssessmentFeedEntry
}

const STATUS_LABELS: Record<AssessmentFeedEntry['status'], string> = {
  queued: 'Queued',
  assessing: 'Assessing',
  assessed: 'Assessed',
  uncertain: 'Uncertain',
  'awaiting-configuration': 'Awaiting configuration',
  'awaiting-pds-resolution': 'Resolving PDS',
  failed: 'Assessment failed',
  'legacy-stale': 'Needs reassessment',
}

function getRelativeTime(timestamp: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(timestamp).getTime())
  const minutes = Math.floor(elapsed / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 1) return '<1m ago'
  if (hours < 1) return `${minutes}m ago`
  if (days < 1) return `${hours}h ago`
  return `${days}d ago`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asPercent(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : null
}

function ProbabilitySummary({ probabilities }: { probabilities: Record<string, unknown> | null }) {
  if (!probabilities) return null
  if (probabilities.source === 'configured-test-pds') {
    return <p className='text-xs text-muted-foreground'>Assigned by the configured test-PDS policy; Jev was not called.</p>
  }

  const answers = Object.entries(probabilities).flatMap(([question, rawAnswer]) => {
    const answer = asRecord(rawAnswer)
    if (!answer) return []

    const noul = asPercent(answer.noul)
    if (noul) return [{ question: question.replaceAll('_', ' '), value: `NOUL ${noul}` }]

    const quality = asRecord(answer.probabilities)
    if (quality) {
      const details = Object.entries(quality)
        .map(([label, value]) => {
          const percent = asPercent(value)
          return percent ? `${label.replaceAll('_', ' ')} ${percent}` : null
        })
        .filter((value): value is string => value !== null)
      if (details.length > 0) return [{ question: question.replaceAll('_', ' '), value: details.join(' · ') }]
    }
    return []
  })

  if (answers.length === 0) return <p className='text-xs text-muted-foreground'>No probability details available.</p>

  return (
    <dl className='space-y-2'>
      {answers.map(({ question, value }) => (
        <div key={question} className='flex flex-col gap-0.5 text-xs sm:flex-row sm:justify-between'>
          <dt className='text-muted-foreground capitalize'>{question}</dt>
          <dd className='font-mono text-foreground'>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function AssessmentCard({ entry }: AssessmentCardProps) {
  const [expanded, setExpanded] = useState(false)
  const shortDid = entry.did.replace('did:plc:', '').slice(0, 12) + '…'
  const recordUrl = buildRecordUrl(entry.did, ORGANIZATION_COLLECTION, entry.rkey)
  const labelStatus = entry.publishedTier
    ? entry.labelStatus === 'stale' ? 'Published label may be stale' : 'Label current'
    : 'No label published'

  return (
    <article className='overflow-hidden rounded-lg border border-border bg-card transition-colors hover:bg-accent/20'>
      <div className='flex items-start justify-between gap-3 px-3 py-2.5'>
        <div className='min-w-0'>
          <a
            href={recordUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline'
          >
            {shortDid}
          </a>
          <a
            href={recordUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='mt-1 flex max-w-full items-center gap-1 text-sm font-medium text-foreground hover:text-primary hover:underline'
          >
            <span className='truncate'>{entry.displayName}</span>
            <span className='shrink-0 text-muted-foreground'>↗</span>
          </a>
        </div>
        <span className='shrink-0 pt-0.5 text-[10px] text-muted-foreground/70'>{getRelativeTime(entry.updatedAt)}</span>
      </div>

      <div className='flex flex-wrap items-center gap-2 px-3 pb-2.5'>
        <TierBadge tier={entry.publishedTier} />
        <span className='rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground'>
          {STATUS_LABELS[entry.status]}
        </span>
        {entry.labelStatus === 'stale' && entry.publishedTier && (
          <span className='text-[10px] font-medium text-amber-700 dark:text-amber-300'>{labelStatus}</span>
        )}
        {entry.status === 'failed' && (
          <span className='text-[10px] text-muted-foreground'>A retry is scheduled.</span>
        )}
      </div>

      <div className='border-t border-border/50'>
        <button
          type='button'
          aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}
          className='w-full px-3 py-2 text-left text-[11px] text-muted-foreground hover:text-foreground'
        >
          {expanded ? 'Hide assessment details' : 'Assessment details'}
        </button>
        {expanded && (
          <div className='space-y-3 px-3 pb-3'>
            <div className='flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground'>
              {entry.model && <span>Model: {entry.model}</span>}
              {entry.questionVersion && <span>Questions: {entry.questionVersion}</span>}
              {entry.policyVersion && <span>Policy: {entry.policyVersion}</span>}
              {entry.assessedAt && <span>Assessed: {new Date(entry.assessedAt).toLocaleString()}</span>}
            </div>
            <ProbabilitySummary probabilities={entry.probabilities} />
            {entry.validationNotes.length > 0 && (
              <ul className='list-inside list-disc space-y-1 text-xs text-muted-foreground'>
                {entry.validationNotes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
