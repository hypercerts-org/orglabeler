'use client'

import { useState, useEffect, useCallback } from 'react'
import { ActivityFeed } from '@/components/ActivityFeed'
import type { LabelTier, ActivityLogEntry } from '@/lib/types'

const filterOptions: { label: string; value: LabelTier | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: '⟳ Pending', value: 'pending' },
  { label: '✦ High Quality', value: 'high-quality' },
  { label: '● Standard', value: 'standard' },
  { label: '◌ Draft', value: 'draft' },
  { label: '⚠ Likely Test', value: 'likely-test' },
]

const LIMIT = 20

export default function FeedPage() {
  const [selectedTier, setSelectedTier] = useState<LabelTier | 'all'>('all')
  const [aiOnly, setAiOnly] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [activities, setActivities] = useState<ActivityLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Debounce search query — 300ms delay
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Fix #2: remove offset from deps — use currentOffset param instead of closure
  const fetchActivities = useCallback(
    async (currentOffset: number, reset = false) => {
      if (reset) setLoading(true)
      else setLoadingMore(true)

      try {
        const tierParam = selectedTier === 'all' ? '' : `&tier=${selectedTier}`
        const hfParam = aiOnly ? '&hf=true' : ''
        const searchParam = debouncedQuery ? `&q=${encodeURIComponent(debouncedQuery)}` : ''
        const res = await fetch(
          `/api/recent?limit=${LIMIT}&offset=${currentOffset}${tierParam}${hfParam}${searchParam}`
        )
        if (!res.ok) throw new Error('API error')
        const data = await res.json()

        if (reset) {
          setActivities(data.activities)
          setOffset(LIMIT)
        } else {
          setActivities(prev => [...prev, ...data.activities])
          setOffset(prev => prev + LIMIT)
        }
        setTotal(data.total)
        setError(null)
      } catch (error) {
        console.error('Failed to fetch activities:', error)
        setError('Failed to load data')
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [selectedTier, aiOnly, debouncedQuery]  // depend on tier, AI filter, and search query
  )

  // Fix #3: stable poller — only update if newest item changed, DON'T reset offset
  const pollFirst = useCallback(async () => {
    try {
      const tierParam = selectedTier === 'all' ? '' : `&tier=${selectedTier}`
      const hfParam = aiOnly ? '&hf=true' : ''
      const searchParam = debouncedQuery ? `&q=${encodeURIComponent(debouncedQuery)}` : ''
      const res = await fetch(`/api/recent?limit=${LIMIT}&offset=0${tierParam}${hfParam}${searchParam}`)
      if (!res.ok) throw new Error('API error')
      const data = await res.json()
      setActivities(prev => {
        if (data.activities[0]?.uri === prev[0]?.uri) return prev
        // Merge: replace first page, keep any extra loaded pages
        return [...data.activities, ...prev.slice(LIMIT)]
      })
      setTotal(data.total)
      // Do NOT reset offset — preserve load-more position
    } catch (error) {
      console.error('Failed to poll activities:', error)
    }
  }, [selectedTier, aiOnly, debouncedQuery])

  // Reset and re-fetch when tier, AI filter, or search query changes
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
          Activity Feed
        </h1>
        <p className='text-sm text-muted-foreground mt-1'>
          All detected hypercert activity records.
        </p>
      </div>

      {/* Search input */}
      <input
        type='text'
        placeholder='Search by title or DID...'
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
        <button
          onClick={() => setAiOnly(prev => !prev)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
            aiOnly
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          🤖 AI Evaluated
        </button>
        <span className='text-[11px] text-muted-foreground'>
          {total} activities
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
