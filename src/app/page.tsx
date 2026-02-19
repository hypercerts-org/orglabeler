'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { StatsOverview } from '@/components/StatsOverview'
import { ActivityFeed } from '@/components/ActivityFeed'
import type { LabelStats, ActivityLogEntry } from '@/lib/types'

export default function DashboardPage() {
  const [stats, setStats] = useState<LabelStats | null>(null)
  const [activities, setActivities] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, recentRes] = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/recent?limit=10'),
      ])
      if (!statsRes.ok || !recentRes.ok) throw new Error('API error')
      const statsData = await statsRes.json()
      const recentData = await recentRes.json()
      setStats(statsData.stats)
      setActivities(recentData.activities)
      setError(null)
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000) // Poll every 5s
    return () => clearInterval(interval)
  }, [fetchData])

  return (
    <div className='py-8 space-y-6 animate-fade-in-up'>
      {/* Heading section */}
      <div className='mb-2'>
        <h1 className='font-[family-name:var(--font-syne)] text-2xl font-bold lowercase'>
          hyperlabel
        </h1>
        <p className='text-sm text-muted-foreground mt-1'>
          Monitoring hypercert activity quality across the hypersphere.
        </p>
      </div>

      {/* StatsOverview section */}
      {loading && !stats ? (
        <div className='flex gap-3 overflow-x-auto pb-2'>
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className='bg-secondary animate-pulse rounded-lg h-20 min-w-[140px] flex-shrink-0'
            />
          ))}
        </div>
      ) : stats ? (
        <StatsOverview stats={stats} />
      ) : null}

      {/* Empty state when no activities */}
      {!loading && stats && stats.total === 0 && (
        <div className='text-center py-12 text-muted-foreground text-sm italic'>
          <p>No activities scored yet.</p>
          <p>
            The labeler process will analyze new org.hypercerts.claim.activity records as they
            appear on the network.
          </p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className='text-center py-8 text-rose-500 text-sm'>
          <p>{error}</p>
          <button onClick={() => { setError(null); fetchData() }}
            className='mt-2 text-xs text-muted-foreground hover:text-foreground underline cursor-pointer'>
            Retry
          </button>
        </div>
      )}

      {/* Recent Activity section */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
            Recent Activity
          </h2>
          <Link
            href='/feed'
            className='text-xs text-muted-foreground hover:text-primary transition-colors'
          >
            View all →
          </Link>
        </div>

        {loading && activities.length === 0 ? (
          <div className='space-y-2'>
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className='bg-secondary animate-pulse rounded-lg h-24'
              />
            ))}
          </div>
        ) : (
          <ActivityFeed activities={activities} />
        )}
      </div>
    </div>
  )
}
