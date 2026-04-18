'use client'

import type { ActivityLogEntry } from '@/lib/types'
import { ScoreCard } from './ScoreCard'

interface ActivityFeedProps {
  activities: ActivityLogEntry[]
  title?: string
  showLoadMore?: boolean
  onLoadMore?: () => void
  loading?: boolean
}

export function ActivityFeed({
  activities,
  title,
  showLoadMore,
  onLoadMore,
  loading,
}: ActivityFeedProps) {
  return (
    <div>
      {title && (
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold text-foreground mb-3'>
          {title}
        </h2>
      )}

      {/* Loading state — spinner when no activities yet */}
      {loading && activities.length === 0 && (
        <div className='flex justify-center py-10'>
          <div className='w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin' />
        </div>
      )}

      {/* Empty state */}
      {!loading && activities.length === 0 && (
        <div className='flex flex-col items-center justify-center h-40 text-muted-foreground'>
          <p className='italic'>Waiting for organization records...</p>
          <p className='text-xs mt-1'>Listening for app.certified.actor.organization</p>
        </div>
      )}

      {/* Activity list */}
      {activities.length > 0 && (
        <div className='space-y-2 stagger-children'>
          {activities.map(entry => {
            try {
              return <ScoreCard key={entry.uri ?? entry.id} entry={entry} />
            } catch {
              return null
            }
          })}
        </div>
      )}

      {/* Load more button */}
      {showLoadMore && (
        <button
          className='w-full py-2 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-accent transition-colors cursor-pointer mt-2'
          onClick={() => onLoadMore?.()}
        >
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  )
}
