'use client'

import { useState, useEffect, useLayoutEffect, useCallback } from 'react'
import { ActivityFeed } from '@/components/ActivityFeed'
import { FeedRequestCoordinator, mergeAssessmentFeedEntries, reconcileAssessmentFeedWindow } from '@/lib/assessment-feed'
import type { AssessmentFeedEntry, RuntimeLabelTier } from '@/lib/types'

function normalizeActivity(entry: AssessmentFeedEntry): AssessmentFeedEntry {
  return {
    ...entry,
    validationNotes: Array.isArray(entry.validationNotes) ? entry.validationNotes : [],
  }
}

const filterOptions: { label: string; value: RuntimeLabelTier | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: '⚠ Likely Test', value: 'likely-test' },
  { label: '● Standard', value: 'standard' },
  { label: '✦ High Quality', value: 'high-quality' },
]

const LIMIT = 20
const MAX_API_LIMIT = 100

export default function FeedPage() {
  const [selectedTier, setSelectedTier] = useState<RuntimeLabelTier | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [activities, setActivities] = useState<AssessmentFeedEntry[]>([])
  const [total, setTotal] = useState(0)
  // Tracks API rows consumed; deduplication can make this differ from rendered entry count.
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestCoordinator] = useState(() => new FeedRequestCoordinator())
  const filterIdentity = JSON.stringify([selectedTier, debouncedQuery])

  // Debounce search query — 300ms delay
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useLayoutEffect(() => {
    requestCoordinator.invalidateFilter(filterIdentity)
  }, [filterIdentity, requestCoordinator])

  const fetchActivities = useCallback(
    async (currentOffset: number, reset = false) => {
      const tierParam = selectedTier === 'all' ? '' : `&tier=${selectedTier}`
      const searchParam = debouncedQuery ? `&q=${encodeURIComponent(debouncedQuery)}` : ''
      const requestPage = async () => {
        const res = await fetch(
          `/api/recent?limit=${LIMIT}&offset=${currentOffset}${tierParam}${searchParam}`
        )
        if (!res.ok) throw new Error('API error')
        const data = await res.json()
        return {
          page: (data.activities as AssessmentFeedEntry[]).map(normalizeActivity),
          total: data.total as number,
        }
      }
      const callbacks = {
        apply: ({ page, total }: Awaited<ReturnType<typeof requestPage>>) => {
          if (reset) {
            setActivities(mergeAssessmentFeedEntries([], page, 'append'))
            setOffset(page.length)
          } else {
            setActivities(prev => mergeAssessmentFeedEntries(prev, page, 'append'))
            setOffset(prev => Math.max(prev, currentOffset + page.length))
          }
          setTotal(total)
          setError(null)
        },
        onError: (error: unknown) => {
          console.error('Failed to fetch activities:', error)
          setError('Failed to load data')
        },
        onSettled: () => {
          setLoading(false)
          setLoadingMore(false)
        },
      }
      const request = reset
        ? requestCoordinator.runReset(filterIdentity, requestPage, callbacks)
        : requestCoordinator.runLoadMore(filterIdentity, requestPage, callbacks)
      if (!request) return

      if (reset) {
        setLoading(true)
        setLoadingMore(false)
      } else {
        setLoadingMore(true)
      }
      await request
    },
    [selectedTier, debouncedQuery, filterIdentity, requestCoordinator]
  )

  // Reconcile every loaded API row so polling removes stale membership and preserves the current order.
  const pollFirst = useCallback(async () => {
    if (loading || loadingMore) return

    const request = requestCoordinator.runPoll(filterIdentity, async () => {
      const tierParam = selectedTier === 'all' ? '' : `&tier=${selectedTier}`
      const searchParam = debouncedQuery ? `&q=${encodeURIComponent(debouncedQuery)}` : ''
      const requestedRows = Math.max(LIMIT, offset)
      const pages: AssessmentFeedEntry[][] = []
      let cursor = 0
      let currentTotal = 0

      while (cursor < requestedRows && (pages.length === 0 || cursor < currentTotal)) {
        const limit = Math.min(MAX_API_LIMIT, requestedRows - cursor)
        const res = await fetch(
          `/api/recent?limit=${limit}&offset=${cursor}${tierParam}${searchParam}`
        )
        if (!res.ok) throw new Error('API error')
        const data = await res.json()
        const rows = data.activities as AssessmentFeedEntry[]
        currentTotal = data.total
        pages.push(rows.map(normalizeActivity))
        cursor += rows.length
        if (rows.length === 0) break
      }

      return { window: reconcileAssessmentFeedWindow(pages), total: currentTotal }
    }, {
      apply: ({ window, total }) => {
        setActivities(window.activities)
        setTotal(total)
        setOffset(Math.min(window.consumedRows, total))
      },
      onError: error => console.error('Failed to poll activities:', error),
    })

    if (request) await request
  }, [selectedTier, debouncedQuery, filterIdentity, offset, loading, loadingMore, requestCoordinator])

  // Reset and re-fetch when tier or search query changes
  useEffect(() => {
    fetchActivities(0, true)
  }, [fetchActivities])

  // Poll every 5s for near real-time updates
  useEffect(() => {
    const interval = setInterval(pollFirst, 5000)
    return () => clearInterval(interval)
  }, [pollFirst])

  const handleLoadMore = () => {
    fetchActivities(offset, false)
  }

  return (
    <div className='py-8 space-y-5 animate-fade-in-up'>
      {/* Heading */}
      <div>
        <h1 className='font-[family-name:var(--font-syne)] text-2xl font-bold'>
          Organization Records Feed
        </h1>
        <p className='text-sm text-muted-foreground mt-1'>
          Jev assessments, published labels, and records awaiting review.
        </p>
      </div>

      {/* Search input */}
      <input
        type='text'
        placeholder='Search by organization name or DID...'
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className='w-full px-3 py-2 text-sm bg-secondary border border-border rounded-lg placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary'
      />

      {/* Tier filter + activity count */}
      <div className='flex items-center gap-3 flex-wrap'>
        <div className='flex items-center gap-1 border border-border rounded-lg p-0.5 w-fit'>
          {filterOptions.map(option => (
            <button
              key={option.value}
              onClick={() => setSelectedTier(option.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                selectedTier === option.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className='text-[11px] text-muted-foreground'>
          {total} records
        </span>
      </div>

      {/* Error state */}
      {error && (
        <div className='text-center py-8 text-rose-500 text-sm'>
          <p>{error}</p>
          <button onClick={() => { setError(null); fetchActivities(0, true) }}
            className='mt-2 text-xs text-muted-foreground hover:text-foreground underline cursor-pointer'>
            Retry
          </button>
        </div>
      )}

      {/* Activity feed with load more */}
      <ActivityFeed
        activities={activities}
        loading={loading || loadingMore}
        showLoadMore={activities.length < total && !loading}
        onLoadMore={handleLoadMore}
      />
    </div>
  )
}
