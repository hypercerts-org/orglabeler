import { Tap, SimpleIndexer } from '@atproto/tap'
import type { TapChannel } from '@atproto/tap'
import { TAP_URL, TAP_ADMIN_PASSWORD, ACTIVITY_COLLECTION } from '../lib/config'
import { ACTOR_PDS_CACHE_TTL_MS } from '../lib/actor-pds-policy'
import { normalizePdsHostFromUrl } from '../lib/pds-utils'
import { resolvePdsForDid } from '../lib/resolve-pds'
import {
  claimDueRecomputeJob,
  completeRecomputeJob,
  failRecomputeJob,
  getRecomputeJobCounts,
  getAllJevAssessments,
  getAllOrganizationSnapshots,
  getOrganizationSnapshot,
  getPendingOrganizationDeletes,
  getProfileSnapshot,
  hasMatchingPendingOrganizationDelete,
  hasPendingOrganizationDelete,
  recoverStaleRunningRecomputeJobs,
  recordActorPdsFailure,
  recordActorPdsOk,
  recordPendingOrganizationDeleteAttempt,
  deleteOrganizationRecordState,
  deletePendingOrganizationDelete,
  deleteProfileSnapshot,
  completePendingOrganizationDelete,
  upsertOrganizationSnapshot,
  upsertPendingOrganizationDelete,
  upsertProfileSnapshot,
  updateReassessmentRunItem,
  setJevAssessmentStatus,
} from '../lib/db'
import { applyQualityLabel, fetchCurrentLabels, negateQualityLabels } from './server'
import { salvageProfileFallback } from '../lib/profile-fallback'
import logger from './logger'
import { observeTapHandlerDuration } from './metrics'
import { enqueueUrlChecksForDid } from './url-enrichment-worker'
import {
  processOrganizationAssessment,
  queueOrganizationAssessment,
  queueSavedOrganizationsNeedingAssessment,
} from './jev-assessment-worker'
import { withDidLock } from '../lib/did-lock'
import type { ActivityRecord, ProfileFallbackProfile, ProfileSnapshot } from '../lib/types'
import { $safeParse as $safeParseProfile } from '../lexicons/app/certified/actor/profile.defs'
import { $safeParse } from '../lexicons/app/certified/actor/organization.defs'

const tapConfig = TAP_ADMIN_PASSWORD ? { adminPassword: TAP_ADMIN_PASSWORD } : undefined
const tap = new Tap(TAP_URL, tapConfig)

const PROFILE_COLLECTION = 'app.certified.actor.profile'
const ORGANIZATION_COLLECTION = ACTIVITY_COLLECTION
const TARGET_COLLECTIONS = [PROFILE_COLLECTION, ORGANIZATION_COLLECTION]
const RECOMPUTE_DEBOUNCE_MS = 2000
const RECOMPUTE_WORKER_INTERVAL_MS = 500
const RECOMPUTE_MAX_RETRY_DELAY_MS = 60_000
const RECOMPUTE_MAX_ATTEMPTS = 10
const RECOMPUTE_STALE_RUNNING_AFTER_MS = 5 * 60_000
const PENDING_DELETE_RETRY_BASE_MS = 2000
const PENDING_DELETE_MAX_RETRY_MS = 60_000

const indexer = new SimpleIndexer()

function summarizeValidationNotes(validationNotes: string[]): { noteCount: number; noteSummary: string } {
  const noteCount = validationNotes.length

  if (noteCount === 0) {
    return {
      noteCount,
      noteSummary: 'no validation notes',
    }
  }

  if (noteCount <= 2) {
    return {
      noteCount,
      noteSummary: validationNotes.join('; '),
    }
  }

  return {
    noteCount,
    noteSummary: `${validationNotes.slice(0, 2).join('; ')}; +${noteCount - 2} more`,
  }
}

function summarizeFallbackPreservation(profile: ProfileFallbackProfile | null): {
  displayName: boolean
  description: boolean
  website: boolean
  avatar: boolean
  banner: boolean
} {
  return {
    displayName: Boolean(profile?.displayName),
    description: Boolean(profile?.description),
    website: Boolean(profile?.website),
    avatar: Boolean(profile?.avatar),
    banner: Boolean(profile?.banner),
  }
}

function getProfileIngestMode(profile: ReturnType<typeof getProfileSnapshot>): 'strict' | 'fallback' | 'missing' {
  if (!profile) return 'missing'
  return profile.validationNotes.length > 0 ? 'fallback' : 'strict'
}

function logRecordOutcome(details: {
  did: string
  collection: string
  action: string
  source: 'live' | 'startup' | 'worker'
  labelAction: string
  profileIngestMode?: 'strict' | 'fallback' | 'missing'
}): void {
  logger.info(details, 'Processed Tap record')
}

function enqueueOrganizationRecompute(did: string, reason: string): void {
  queueOrganizationAssessment(did, reason, { delayMs: RECOMPUTE_DEBOUNCE_MS })
}

function retryDelayForAttempt(attempts: number): number {
  const exponent = Math.max(0, attempts - 1)
  return Math.min(RECOMPUTE_MAX_RETRY_DELAY_MS, RECOMPUTE_DEBOUNCE_MS * (2 ** exponent))
}

function pendingDeleteRetryDelayForAttempt(attempts: number): number {
  const exponent = Math.max(0, attempts - 1)
  return Math.min(PENDING_DELETE_MAX_RETRY_MS, PENDING_DELETE_RETRY_BASE_MS * (2 ** exponent))
}

function parseRecomputePayload(payload: string | null): { force: boolean; runIds: string[] } {
  if (!payload) return { force: false, runIds: [] }
  try {
    const parsed: unknown = JSON.parse(payload)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { force: false, runIds: [] }
    const value = parsed as Record<string, unknown>
    return {
      force: value['force'] === true,
      runIds: Array.isArray(value['runIds'])
        ? value['runIds'].filter((item): item is string => typeof item === 'string')
        : [],
    }
  } catch {
    return { force: false, runIds: [] }
  }
}

async function resolveAndCacheActorPds(did: string): Promise<{ pdsUrl: string; pdsHost: string }> {
  const { pds } = await resolvePdsForDid(did)
  const pdsHost = normalizePdsHostFromUrl(pds)
  if (!pdsHost) {
    throw new Error(`Resolved PDS endpoint for ${did} is not a valid URL: ${pds}`)
  }

  recordActorPdsOk(did, pds, pdsHost, ACTOR_PDS_CACHE_TTL_MS)
  return { pdsUrl: pds, pdsHost }
}

async function processPendingOrganizationDeletes(source: 'startup' | 'worker'): Promise<number> {
  const pendingDeletes = getPendingOrganizationDeletes()
  let processed = 0

  for (const pendingDelete of pendingDeletes) {
    try {
      logger.info(
        { did: pendingDelete.did, rkey: pendingDelete.rkey, uri: pendingDelete.record_uri, source },
        'Retrying pending organization DID label negation before cleanup',
      )

      const result = await withDidLock(pendingDelete.did, async () => {
        if (!hasMatchingPendingOrganizationDelete(pendingDelete.did, pendingDelete.rkey, pendingDelete.record_uri)) {
          return { completed: false, negatedCount: 0 }
        }

        const negatedCount = await negateQualityLabels(pendingDelete.did)
        const completed = completePendingOrganizationDelete(
          pendingDelete.did,
          pendingDelete.rkey,
          pendingDelete.record_uri,
        )
        return { completed, negatedCount }
      })

      if (!result.completed) {
        logger.info(
          { did: pendingDelete.did, rkey: pendingDelete.rkey, uri: pendingDelete.record_uri, source },
          'Pending organization delete was already superseded; skipped DID label negation and local cleanup',
        )
        continue
      }

      const negatedCount = result.negatedCount
      processed++

      logRecordOutcome({
        did: pendingDelete.did,
        collection: ORGANIZATION_COLLECTION,
        action: 'delete',
        source,
        labelAction: negatedCount > 0 ? 'negated' : 'unchanged',
        profileIngestMode: getProfileIngestMode(getProfileSnapshot(pendingDelete.did)),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const attempts = pendingDelete.attempts + 1
      const retryDelayMs = pendingDeleteRetryDelayForAttempt(attempts)
      recordPendingOrganizationDeleteAttempt(pendingDelete.did, message, retryDelayMs)
      logger.error(
        { err, did: pendingDelete.did, rkey: pendingDelete.rkey, uri: pendingDelete.record_uri, source, retryDelayMs },
        'Pending organization delete negation failed; retry scheduled',
      )
    }
  }

  return processed
}

export async function reconcileStoredOrganizationSnapshots(): Promise<number> {
  await processPendingOrganizationDeletes('startup')

  const snapshots = getAllOrganizationSnapshots()
  const queued = queueSavedOrganizationsNeedingAssessment()

  if (snapshots.length > 0) {
    logger.info({ count: snapshots.length, queued }, 'Queued saved organization snapshots needing Jev assessment')
  } else {
    logger.info('No local organization snapshots found for startup reconciliation')
  }

  return snapshots.length
}

async function handleOrganizationDelete(did: string, rkey: string): Promise<void> {
  await withDidLock(did, async () => {
    const organization = getOrganizationSnapshot(did)
    const recordUri = organization?.recordUri ?? `at://${did}/${ORGANIZATION_COLLECTION}/${rkey}`

    upsertPendingOrganizationDelete(did, rkey, recordUri)
    deleteOrganizationRecordState(did, rkey)

    logRecordOutcome({
      did,
      collection: ORGANIZATION_COLLECTION,
      action: 'delete',
      source: 'live',
      labelAction: 'delete-queued',
      profileIngestMode: getProfileIngestMode(getProfileSnapshot(did)),
    })
  })
}

async function handleProfileDelete(did: string): Promise<void> {
  await withDidLock(did, async () => {
    deleteProfileSnapshot(did)

    if (getOrganizationSnapshot(did)) {
      enqueueOrganizationRecompute(did, 'profile-delete')
    }

    logRecordOutcome({
      did,
      collection: PROFILE_COLLECTION,
      action: 'delete',
      source: 'live',
      labelAction: getOrganizationSnapshot(did) ? 'recompute-queued' : 'profile-deleted',
      profileIngestMode: 'missing',
    })
  })
}

indexer.record(async (evt) => {
  const startedAt = performance.now()
  try {
    const eventMeta = {
      collection: evt.collection,
      action: evt.action,
      did: evt.did,
      rkey: evt.rkey,
    }

    if (evt.collection === PROFILE_COLLECTION) {
      if (evt.action === 'delete') {
        await handleProfileDelete(evt.did)
        return
      }

      if (!evt.record) {
        logger.warn(eventMeta, 'Skipping profile event with missing record payload')
        return
      }

      const parsed = $safeParseProfile(evt.record)
      let payload: ProfileSnapshot['payload']
      let validationNotes: string[]
      if (parsed.success) {
        payload = parsed.value
        validationNotes = []
      } else {
        const fallback = salvageProfileFallback(evt.record)
        const preserved = fallback.mode === 'fallback'
          ? summarizeFallbackPreservation(fallback.profile)
          : summarizeFallbackPreservation(null)

        logger.warn(
          { ...eventMeta, reason: parsed.reason?.message },
          'Profile record failed strict lexicon validation; attempting fallback',
        )

        if (fallback.mode === 'unusable') {
          const { noteCount, noteSummary } = summarizeValidationNotes(fallback.validationNotes)

          logger.warn(
            {
              ...eventMeta,
              fallbackSucceeded: false,
              reason: parsed.reason?.message,
              noteCount,
              noteSummary,
              fallbackReason: fallback.validationNotes[0],
              preserved,
            },
            'Profile record was unusable after fallback; skipping',
          )
          return
        }

        payload = fallback.profile as ProfileSnapshot['payload']
        validationNotes = fallback.validationNotes
      }

      await withDidLock(evt.did, async () => {
        upsertProfileSnapshot({
          did: evt.did,
          recordUri: `at://${evt.did}/${PROFILE_COLLECTION}/${evt.rkey}`,
          rkey: evt.rkey,
          payload,
          validationNotes,
          updatedAt: new Date().toISOString(),
        })

        if (getOrganizationSnapshot(evt.did)) {
          enqueueOrganizationRecompute(evt.did, 'profile-upsert')
        }

        logRecordOutcome({
          did: evt.did,
          collection: PROFILE_COLLECTION,
          action: evt.action,
          source: 'live',
          labelAction: getOrganizationSnapshot(evt.did) ? 'recompute-queued' : 'profile-saved',
          profileIngestMode: getProfileIngestMode(getProfileSnapshot(evt.did)),
        })
      })

      return
    }

    if (evt.collection !== ORGANIZATION_COLLECTION) {
      return
    }

    if (evt.action === 'delete') {
      await handleOrganizationDelete(evt.did, evt.rkey)
      return
    }

    if (!evt.record) {
      logger.warn(eventMeta, 'Skipping organization event with missing record payload')
      return
    }

    // Validate against the app.certified.actor.organization lexicon
    const parsed = $safeParse(evt.record)
    if (!parsed.success) {
      logger.warn({ ...eventMeta, reason: parsed.reason?.message }, 'Organization record failed lexicon validation — skipping')
      return
    }
    const record = parsed.value as ActivityRecord
    await withDidLock(evt.did, async () => {
      deletePendingOrganizationDelete(evt.did)
      upsertOrganizationSnapshot({
        did: evt.did,
        recordUri: `at://${evt.did}/${ORGANIZATION_COLLECTION}/${evt.rkey}`,
        rkey: evt.rkey,
        payload: record,
        updatedAt: new Date().toISOString(),
      })

      enqueueOrganizationRecompute(evt.did, 'organization-upsert')

      logRecordOutcome({
        did: evt.did,
        collection: ORGANIZATION_COLLECTION,
        action: evt.action,
        source: 'live',
        labelAction: 'recompute-queued',
        profileIngestMode: getProfileIngestMode(getProfileSnapshot(evt.did)),
      })
    })
  } finally {
    observeTapHandlerDuration(evt.collection, evt.action, performance.now() - startedAt)
  }
})

indexer.error((err) => {
  logger.error({ err }, 'SimpleIndexer error')
})

export async function syncLabelsWithDb(): Promise<void> {
  const assessments = getAllJevAssessments().filter(
    assessment => assessment.status === 'assessed'
      && assessment.labelStatus === 'current'
      && assessment.publishedTier !== null,
  )
  let synced = 0

  for (const assessment of assessments) {
    const tier = assessment.publishedTier
    if (!tier) continue

    try {
      const currentLabels = await fetchCurrentLabels(assessment.did)
      const currentQuality = [...currentLabels].filter(label =>
        label === 'likely-test' || label === 'standard' || label === 'high-quality',
      )

      if (!currentQuality.includes(tier)) {
        logger.info(
          { did: assessment.did, tier, atprotoLabels: currentQuality },
          'Syncing current Jev assessment label',
        )
        await applyQualityLabel(assessment.did, tier)
        synced++
      }
    } catch (err) {
      logger.warn({ err, did: assessment.did, uri: assessment.uri }, 'Failed to sync label, continuing')
    }
  }

  if (synced > 0) {
    logger.info({ count: synced }, 'Synced mismatched DID labels with DB tiers')
  } else {
    logger.info('All DID labels match DB tiers')
  }
}

/**
 * Starts the durable recompute loop that drains debounced actor jobs after Tap
 * events have been acknowledged. The worker performs Jev assessment, actor PDS resolution,
 * label writes, and pending delete cleanup outside the Tap handler.
 */
export function startRecomputeWorker(): { destroy: () => void } {
  let stopped = false
  let running = false
  let timer: NodeJS.Timeout | null = null

  const tick = async (): Promise<void> => {
    if (stopped || running) return
    running = true

    try {
      const recovered = recoverStaleRunningRecomputeJobs(RECOMPUTE_STALE_RUNNING_AFTER_MS)
      if (recovered > 0) {
        logger.warn({ recovered }, 'Recovered stale running recompute jobs')
      }

      await processPendingOrganizationDeletes('worker')

      let job = claimDueRecomputeJob()
      while (job) {
        const currentJob = job
        try {
          if (currentJob.kind === 'resolve-actor-pds') {
            const resolved = await resolveAndCacheActorPds(currentJob.key)
            const payload = parseRecomputePayload(currentJob.payload)
            queueOrganizationAssessment(currentJob.key, 'actor-pds-resolved', {
              force: payload.force,
              runIds: payload.runIds,
            })
            completeRecomputeJob(currentJob.id)
            logger.info(
              { did: currentJob.key, pdsUrl: resolved.pdsUrl, pdsHost: resolved.pdsHost },
              'Resolved actor PDS and queued Jev assessment',
            )
            job = claimDueRecomputeJob()
            continue
          }

          if (currentJob.kind !== 'recompute-org') {
            completeRecomputeJob(currentJob.id)
            job = claimDueRecomputeJob()
            continue
          }

          const payload = parseRecomputePayload(currentJob.payload)
          const outcome = await processOrganizationAssessment(currentJob.key, payload)
          if (outcome !== 'deleted') {
            enqueueUrlChecksForDid(currentJob.key)
            logRecordOutcome({
              did: currentJob.key,
              collection: ORGANIZATION_COLLECTION,
              action: 'assess',
              source: 'worker',
              labelAction: outcome,
              profileIngestMode: getProfileIngestMode(getProfileSnapshot(currentJob.key)),
            })
          }

          completeRecomputeJob(currentJob.id)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const retryDelayMs = retryDelayForAttempt(currentJob.attempts)

          const payload = parseRecomputePayload(currentJob.payload)
          if (currentJob.kind === 'resolve-actor-pds') {
            recordActorPdsFailure(currentJob.key, message, retryDelayMs)
          }

          if (currentJob.attempts >= RECOMPUTE_MAX_ATTEMPTS) {
            if (currentJob.kind === 'resolve-actor-pds') {
              setJevAssessmentStatus(currentJob.key, 'failed', message)
            }
            for (const runId of payload.runIds) {
              updateReassessmentRunItem(runId, currentJob.key, 'failed')
            }
            logger.error({ err, job: currentJob }, 'Recompute job exceeded max attempts; leaving failed for inspection')
            failRecomputeJob(currentJob.id, message, RECOMPUTE_MAX_RETRY_DELAY_MS, 'failed')
          } else {
            failRecomputeJob(currentJob.id, message, retryDelayMs)
            logger.error({ err, job: currentJob, retryDelayMs }, 'Recompute job failed; retry scheduled')
          }
        }

        job = claimDueRecomputeJob()
      }
    } finally {
      running = false
    }
  }

  timer = setInterval(() => {
    tick().catch(err => logger.error({ err }, 'Recompute worker tick failed'))
  }, RECOMPUTE_WORKER_INTERVAL_MS)

  logger.info({ counts: getRecomputeJobCounts() }, 'Recompute worker started')
  tick().catch(err => logger.error({ err }, 'Initial recompute worker tick failed'))

  return {
    destroy: () => {
      stopped = true
      if (timer) clearInterval(timer)
      logger.info({ counts: getRecomputeJobCounts() }, 'Recompute worker stopped')
    },
  }
}

export function startTapConsumer(): { channel: TapChannel; destroy: () => Promise<void> } {
  logger.info({ collections: TARGET_COLLECTIONS }, 'Starting Tap consumer for target collections')
  const channel = tap.channel(indexer)
  // channel.start() returns a promise that resolves when destroyed - do NOT await it
  channel.start().catch((err) => {
    logger.error({ err }, 'Tap channel fatal error — exiting')
    process.exit(1)
  })
  logger.info({ collections: TARGET_COLLECTIONS }, 'Tap consumer started and waiting for events')
  return {
    channel,
    destroy: () => channel.destroy(),
  }
}
