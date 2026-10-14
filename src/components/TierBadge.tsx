import type { RuntimeLabelTier } from '@/lib/types'

interface TierBadgeProps {
  tier: RuntimeLabelTier | null
}

const COLORS: Record<RuntimeLabelTier, string> = {
  'likely-test': 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  standard: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  'high-quality': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
}

const LABELS: Record<RuntimeLabelTier, string> = {
  'likely-test': 'Likely test',
  standard: 'Standard',
  'high-quality': 'High quality',
}

export function TierBadge({ tier }: TierBadgeProps) {
  if (!tier) return null

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${COLORS[tier]}`}>
      {LABELS[tier]}
    </span>
  )
}
