'use client'

import type { LabelTier } from '@/lib/types'

interface ScoreBadgeProps {
  tier: LabelTier
  score?: number
  size?: 'sm' | 'md'
}

const TIER_COLORS: Record<LabelTier, string> = {
  'high-quality': 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
  'standard': 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
  'draft': 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',
  'likely-test': 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20',
}

const TIER_LABELS: Record<LabelTier, string> = {
  'high-quality': '✦ High Quality',
  'standard': '● Standard',
  'draft': '◌ Draft',
  'likely-test': '⚠ Likely Test',
}

export function ScoreBadge({ tier, score, size = 'sm' }: ScoreBadgeProps) {
  const colorClass = TIER_COLORS[tier]
  const label = TIER_LABELS[tier]
  const sizeClass = size === 'sm'
    ? 'text-[10px] px-2 py-0.5 rounded-full border font-medium'
    : 'text-xs px-2.5 py-1 rounded-full border font-medium'

  return (
    <span className={`inline-flex items-center whitespace-nowrap ${sizeClass} ${colorClass}`}>
      {label}{score !== undefined ? ` (${score})` : ''}
    </span>
  )
}
