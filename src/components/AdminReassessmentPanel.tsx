'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ReassessmentRun } from '@/lib/types'
import { ADMIN_CSRF_HEADER_NAME } from '@/lib/admin-constants'

interface AdminReassessmentPanelProps {
  did: string
  csrfToken: string
}

function progress(run: ReassessmentRun): number {
  return run.total === 0 ? 100 : Math.round((run.completed / run.total) * 100)
}

export function AdminReassessmentPanel({ did, csrfToken }: AdminReassessmentPanelProps) {
  const [run, setRun] = useState<ReassessmentRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (runId?: string) => {
    try {
      const query = runId ? `?runId=${encodeURIComponent(runId)}` : ''
      const response = await fetch(`/api/admin/reassessment${query}`, { cache: 'no-store' })
      if (response.status === 401 || response.status === 403) {
        setError('Your admin session is no longer valid. Sign in again.')
        setRun(null)
        return
      }
      if (!response.ok) throw new Error('Could not load reassessment status.')
      const body = await response.json() as { run: ReassessmentRun | null }
      setRun(body.run)
      setError(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load reassessment status.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!run || run.status !== 'running') return
    const interval = setInterval(() => { void refresh(run.id) }, 1500)
    return () => clearInterval(interval)
  }, [refresh, run?.id, run?.status])

  const signOut = async () => {
    setSigningOut(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/logout', {
        method: 'POST',
        headers: { [ADMIN_CSRF_HEADER_NAME]: csrfToken },
      })
      if (!response.ok) throw new Error('Could not end the admin session. Refresh and try again.')
      window.location.assign('/admin')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not end the admin session.')
      setSigningOut(false)
    }
  }

  const startReassessment = async () => {
    if (!window.confirm('Reassess every saved organization using fresh Jev inference? This may use TypeSafe API quota.')) return
    setStarting(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/reassessment', {
        method: 'POST',
        headers: { [ADMIN_CSRF_HEADER_NAME]: csrfToken },
      })
      const body = await response.json() as { run?: ReassessmentRun; error?: string }
      if (!response.ok && response.status !== 409) {
        throw new Error(response.status === 401 || response.status === 403
          ? 'Your admin session is no longer valid. Sign in again.'
          : 'Could not start the reassessment run.')
      }
      setRun(body.run ?? null)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not start the reassessment run.')
    } finally {
      setStarting(false)
    }
  }

  return (
    <section className='space-y-4 rounded-lg border border-border bg-card p-5'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-xs uppercase tracking-wide text-muted-foreground'>Signed in as</p>
          <p className='mt-1 break-all font-mono text-sm'>{did}</p>
        </div>
        <button
          type='button'
          disabled={signingOut}
          onClick={() => void signOut()}
          className='rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50'
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>

      <div>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>Bulk reassessment</h2>
        <p className='mt-1 text-sm text-muted-foreground'>
          Reassessment uses saved records, applies configured test-PDS policy first, and forces fresh Jev inference for other organizations.
        </p>
      </div>

      <button
        type='button'
        disabled={starting || loading || run?.status === 'running'}
        onClick={() => void startReassessment()}
        className='rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50'
      >
        {starting ? 'Starting…' : run?.status === 'running' ? 'Reassessment running' : 'Reassess all organizations'}
      </button>

      {run && (
        <div aria-live='polite' className='space-y-2 border-t border-border pt-4'>
          <div className='flex flex-wrap items-baseline justify-between gap-2 text-sm'>
            <span className='font-medium'>{run.status === 'running' ? 'Run in progress' : 'Run complete'}</span>
            <span className='font-mono text-xs text-muted-foreground'>{run.completed}/{run.total} processed · {run.failed} failed · {run.skipped} skipped</span>
          </div>
          <div
            role='progressbar'
            aria-label='Reassessment progress'
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress(run)}
            className='h-2 overflow-hidden rounded-full bg-secondary'
          >
            <div className='h-full rounded-full bg-primary transition-[width]' style={{ width: `${progress(run)}%` }} />
          </div>
        </div>
      )}

      {error && <p role='alert' className='text-sm text-rose-600 dark:text-rose-400'>{error}</p>}
    </section>
  )
}
