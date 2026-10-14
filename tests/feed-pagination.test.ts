import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssessmentFeedEntry } from '../src/lib/types'
import { FeedRequestCoordinator, mergeAssessmentFeedEntries, reconcileAssessmentFeedWindow } from '../src/lib/assessment-feed'

interface FeedWindowResult {
  activities: AssessmentFeedEntry[]
  consumedRows: number
  total: number
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function coordinatorFor(filterIdentity: string): Promise<FeedRequestCoordinator> {
  const coordinator = new FeedRequestCoordinator()
  const initialized = coordinator.runReset(filterIdentity, async () => undefined, { apply: () => {} })
  assert.equal(await initialized, true)
  return coordinator
}

function feedEntry(uri: string, displayName = uri): AssessmentFeedEntry {
  return {
    did: 'did:example:feed',
    rkey: 'self',
    uri,
    displayName,
    status: 'queued',
    publishedTier: null,
    labelStatus: 'none',
    model: null,
    questionVersion: null,
    policyVersion: null,
    probabilities: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    assessedAt: null,
    validationNotes: [],
  }
}

test('poll reconciliation removes stale membership and deduplicates the refreshed result window', () => {
  const previouslyLoaded = [
    feedEntry('at://did:example/feed/old-top'),
    feedEntry('at://did:example/feed/displaced'),
    feedEntry('at://did:example/feed/removed-by-filter'),
  ]
  const pages = [
    [feedEntry('at://did:example/feed/new-a'), feedEntry('at://did:example/feed/new-b')],
    [
      feedEntry('at://did:example/feed/new-b', 'Repeated first-page entry'),
      feedEntry(previouslyLoaded[1]!.uri, 'Still in the loaded result window'),
      feedEntry('at://did:example/feed/current'),
    ],
  ]

  const reconciled = reconcileAssessmentFeedWindow(pages)
  const repeatedPoll = reconcileAssessmentFeedWindow(pages)

  assert.deepEqual(reconciled.activities.map(entry => entry.uri), [
    'at://did:example/feed/new-a',
    'at://did:example/feed/new-b',
    'at://did:example/feed/displaced',
    'at://did:example/feed/current',
  ])
  assert.equal(reconciled.activities.some(entry => entry.uri === 'at://did:example/feed/removed-by-filter'), false)
  assert.equal(reconciled.activities[2]?.displayName, 'Still in the loaded result window')
  assert.equal(new Set(reconciled.activities.map(entry => entry.uri)).size, reconciled.activities.length)
  assert.equal(reconciled.consumedRows, 5)
  assert.equal(reconciled.activities.length, 4)
  assert.deepEqual(repeatedPoll, reconciled)

  const paginated = mergeAssessmentFeedEntries(reconciled.activities, [
    feedEntry('at://did:example/feed/new-a', 'Overlap'),
    feedEntry('at://did:example/feed/later'),
  ], 'append')
  assert.equal(paginated.length, 5)
  assert.equal(paginated.at(-1)?.uri, 'at://did:example/feed/later')
})

test('an older poll cannot replace rows appended by an in-flight load-more', async () => {
  const filterIdentity = 'all|'
  const coordinator = await coordinatorFor(filterIdentity)
  const initial = Array.from({ length: 20 }, (_, index) => feedEntry(`at://did:example/feed/current-${index}`))
  const loadedPage = Array.from({ length: 20 }, (_, index) => feedEntry(`at://did:example/feed/later-${index}`))
  let activities = initial
  let offset = 20

  const pollResponse = deferred<FeedWindowResult>()
  const poll = coordinator.runPoll(filterIdentity, () => pollResponse.promise, {
    apply: result => {
      activities = result.activities
      offset = Math.min(result.consumedRows, result.total)
    },
  })
  assert.ok(poll)

  const loadMoreResponse = deferred<FeedWindowResult>()
  const loadMore = coordinator.runLoadMore(filterIdentity, () => loadMoreResponse.promise, {
    apply: result => {
      activities = mergeAssessmentFeedEntries(activities, result.activities, 'append')
      offset = Math.max(offset, 20 + result.consumedRows)
    },
  })
  assert.ok(loadMore)

  let pollRequestsWhileLoading = 0
  const blockedPoll = coordinator.runPoll(filterIdentity, async () => {
    pollRequestsWhileLoading += 1
    return { activities: initial, consumedRows: 20, total: 40 }
  }, { apply: () => {} })
  assert.equal(blockedPoll, null)
  assert.equal(pollRequestsWhileLoading, 0)

  loadMoreResponse.resolve({ activities: loadedPage, consumedRows: 20, total: 40 })
  assert.equal(await loadMore, true)
  pollResponse.resolve({ activities: initial, consumedRows: 20, total: 40 })
  assert.equal(await poll, false)

  assert.equal(activities.length, 40)
  assert.equal(offset, 40)
  assert.equal(activities.at(-1)?.uri, 'at://did:example/feed/later-19')
})

test('an old-filter poll cannot overwrite a completed filter reset', async () => {
  const oldFilter = 'all|'
  const newFilter = 'standard|'
  const coordinator = await coordinatorFor(oldFilter)
  const oldRows = [feedEntry('at://did:example/feed/old-filter')]
  const filteredRows = [feedEntry('at://did:example/feed/standard-only')]
  let activities = oldRows
  let currentFilter = oldFilter

  const pollResponse = deferred<FeedWindowResult>()
  const poll = coordinator.runPoll(oldFilter, () => pollResponse.promise, {
    apply: result => {
      activities = result.activities
      currentFilter = oldFilter
    },
  })
  assert.ok(poll)

  const resetResponse = deferred<FeedWindowResult>()
  const reset = coordinator.runReset(newFilter, () => resetResponse.promise, {
    apply: result => {
      activities = result.activities
      currentFilter = newFilter
    },
  })

  resetResponse.resolve({ activities: filteredRows, consumedRows: 1, total: 1 })
  assert.equal(await reset, true)
  pollResponse.resolve({ activities: oldRows, consumedRows: 1, total: 20 })
  assert.equal(await poll, false)

  assert.equal(currentFilter, newFilter)
  assert.deepEqual(activities.map(entry => entry.uri), ['at://did:example/feed/standard-only'])
})
