'use client'

import type { LabelTier, RuntimeLabelTier } from '@/lib/types'

interface ScoreBadgeProps {
  tier: LabelTier
  score?: number
  size?: 'sm' | 'md'
}

const TIER_COLORS: Record<RuntimeLabelTier, string> = {
  'high-quality': 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
  'standard': 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
  'likely-test': 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20',
}

const TIER_LABELS: Record<RuntimeLabelTier, string> = {
  'high-quality': '✦ High Quality',
  'standard': '● Standard',
  'likely-test': '⚠ Likely Test',
}

function toRuntimeTier(tier: LabelTier): RuntimeLabelTier {
  return tier === 'high-quality' || tier === 'standard' || tier === 'likely-test'
    ? tier
    : 'likely-test'
}

function isRuntimeTier(tier: LabelTier): tier is RuntimeLabelTier {
  return tier === 'high-quality' || tier === 'standard' || tier === 'likely-test'
}

export function ScoreBadge({ tier, score, size = 'sm' }: ScoreBadgeProps) {
  const runtimeTier = toRuntimeTier(tier)
  const colorClass = TIER_COLORS[runtimeTier]
  const label = TIER_LABELS[runtimeTier]
  const displayScore = isRuntimeTier(tier) ? score : undefined
  const sizeClass = size === 'sm'
    ? 'text-[10px] px-2 py-0.5 rounded-full border font-medium'
    : 'text-xs px-2.5 py-1 rounded-full border font-medium'

  return (
    <span className={`inline-flex items-center whitespace-nowrap ${sizeClass} ${colorClass}`}>
      {label}{displayScore !== undefined ? ` (${displayScore})` : ''}
    </span>
  )
}
