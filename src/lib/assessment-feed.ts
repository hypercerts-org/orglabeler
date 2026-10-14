import type { AssessmentFeedEntry } from './types'

/** Merges feed pages in order, keeping the first occurrence of each record URI. */
export function reconcileAssessmentFeedWindow(pages: AssessmentFeedEntry[][]): {
  activities: AssessmentFeedEntry[]
  consumedRows: number
} {
  const seen = new Set<string>()
  const activities: AssessmentFeedEntry[] = []
  let consumedRows = 0

  for (const page of pages) {
    consumedRows += page.length
    for (const entry of page) {
      if (seen.has(entry.uri)) continue
      seen.add(entry.uri)
      activities.push(entry)
    }
  }

  return { activities, consumedRows }
}

export function mergeAssessmentFeedEntries(
  current: AssessmentFeedEntry[],
  incoming: AssessmentFeedEntry[],
  placement: 'prepend' | 'append',
): AssessmentFeedEntry[] {
  const ordered = placement === 'prepend'
    ? [...incoming, ...current]
    : [...current, ...incoming]
  const seen = new Set<string>()
  const merged: AssessmentFeedEntry[] = []

  for (const entry of ordered) {
    if (seen.has(entry.uri)) continue
    seen.add(entry.uri)
    merged.push(entry)
  }

  return merged
}

export interface FeedRequestCallbacks<T> {
  apply: (value: T) => void
  onError?: (error: unknown) => void
  onSettled?: () => void
}

interface FeedRequestTicket {
  generation: number
  id: number
  filterIdentity: string
  kind: 'reset' | 'load-more' | 'poll'
}

/** Grants feed responses permission to commit only while their filter window is current. */
export class FeedRequestCoordinator {
  private generation = 0
  private nextId = 0
  private currentFilterIdentity: string | null = null
  private activeReset: number | null = null
  private activeLoadMore: number | null = null
  private activePoll: number | null = null

  /** Invalidates outstanding work as soon as the selected filter changes. */
  invalidateFilter(filterIdentity: string): void {
    if (this.currentFilterIdentity === filterIdentity) return

    this.generation += 1
    this.currentFilterIdentity = filterIdentity
    this.activeReset = null
    this.activeLoadMore = null
    this.activePoll = null
  }

  runReset<T>(
    filterIdentity: string,
    request: () => Promise<T>,
    callbacks: FeedRequestCallbacks<T>,
  ): Promise<boolean> {
    const ticket = this.beginReset(filterIdentity)
    return this.execute(ticket, request, callbacks)
  }

  runLoadMore<T>(
    filterIdentity: string,
    request: () => Promise<T>,
    callbacks: FeedRequestCallbacks<T>,
  ): Promise<boolean> | null {
    const ticket = this.beginLoadMore(filterIdentity)
    return ticket ? this.execute(ticket, request, callbacks) : null
  }

  runPoll<T>(
    filterIdentity: string,
    request: () => Promise<T>,
    callbacks: FeedRequestCallbacks<T>,
  ): Promise<boolean> | null {
    const ticket = this.beginPoll(filterIdentity)
    return ticket ? this.execute(ticket, request, callbacks) : null
  }

  private beginReset(filterIdentity: string): FeedRequestTicket {
    this.generation += 1
    this.currentFilterIdentity = filterIdentity
    this.activeLoadMore = null
    this.activePoll = null
    const ticket = this.createTicket('reset', filterIdentity)
    this.activeReset = ticket.id
    return ticket
  }

  private beginLoadMore(filterIdentity: string): FeedRequestTicket | null {
    if (
      this.currentFilterIdentity !== filterIdentity
      || this.activeReset !== null
      || this.activeLoadMore !== null
    ) return null

    this.generation += 1
    this.activePoll = null
    const ticket = this.createTicket('load-more', filterIdentity)
    this.activeLoadMore = ticket.id
    return ticket
  }

  private beginPoll(filterIdentity: string): FeedRequestTicket | null {
    if (
      this.currentFilterIdentity !== filterIdentity
      || this.activeReset !== null
      || this.activeLoadMore !== null
      || this.activePoll !== null
    ) return null

    const ticket = this.createTicket('poll', filterIdentity)
    this.activePoll = ticket.id
    return ticket
  }

  private createTicket(kind: FeedRequestTicket['kind'], filterIdentity: string): FeedRequestTicket {
    return {
      generation: this.generation,
      id: ++this.nextId,
      filterIdentity,
      kind,
    }
  }

  private isCurrent(ticket: FeedRequestTicket): boolean {
    if (
      ticket.generation !== this.generation
      || ticket.filterIdentity !== this.currentFilterIdentity
    ) return false

    if (ticket.kind === 'reset') return this.activeReset === ticket.id
    if (ticket.kind === 'load-more') return this.activeLoadMore === ticket.id
    return this.activePoll === ticket.id
  }

  private release(ticket: FeedRequestTicket): void {
    if (ticket.kind === 'reset' && this.activeReset === ticket.id) this.activeReset = null
    if (ticket.kind === 'load-more' && this.activeLoadMore === ticket.id) this.activeLoadMore = null
    if (ticket.kind === 'poll' && this.activePoll === ticket.id) this.activePoll = null
  }

  private async execute<T>(
    ticket: FeedRequestTicket,
    request: () => Promise<T>,
    callbacks: FeedRequestCallbacks<T>,
  ): Promise<boolean> {
    try {
      const value = await request()
      if (!this.isCurrent(ticket)) return false
      callbacks.apply(value)
      return true
    } catch (error) {
      if (this.isCurrent(ticket)) callbacks.onError?.(error)
      return false
    } finally {
      const wasCurrent = this.isCurrent(ticket)
      this.release(ticket)
      if (wasCurrent) callbacks.onSettled?.()
    }
  }
}
