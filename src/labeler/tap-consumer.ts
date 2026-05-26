import { Tap, SimpleIndexer } from '@atproto/tap'
import type { TapChannel } from '@atproto/tap'
import { TAP_URL, TAP_ADMIN_PASSWORD, ACTIVITY_COLLECTION } from '../lib/config'
import { scoreActivity } from '../lib/scorer'
import {
  logActivity,
  getUnclassifiedActivities,
  getAllActivitiesForSync,
  claimDueRecomputeJob,
  completeRecomputeJob,
  enqueueRecomputeJob,
  failRecomputeJob,
  getRecomputeJobCounts,
  hasPendingOrganizationDelete,
  recoverStaleRunningRecomputeJobs,
  getProfileSnapshot,
  getOrganizationSnapshot,
  getAllOrganizationSnapshots,
  deleteProfileSnapshot,
  deleteOrganizationRecordState,
  deletePendingOrganizationDelete,
  clearActivityHfFields,
  getPendingOrganizationDeletes,
  recordPendingOrganizationDeleteAttempt,
  upsertProfileSnapshot,
  upsertOrganizationSnapshot,
  upsertPendingOrganizationDelete,
} from '../lib/db'
import { enqueueClassification, reevaluateExistingClassifications } from '../lib/hf-classifier'
import { applyQualityLabel, fetchCurrentLabels, negateQualityLabels } from './server'
import { getMergedActorDisplay } from '../lib/actor-display'
import { buildMergedScoringInput } from '../lib/scoring-input'
import { salvageProfileFallback } from '../lib/profile-fallback'
import logger from './logger'
import { observeTapHandlerDuration } from './metrics'
import { enqueueUrlChecksForDid, getUrlResolutionMapForDid } from './url-enrichment-worker'
import type { ActivityRecord, ProfileFallbackProfile, ProfileSnapshot, RuntimeLabelTier } from '../lib/types'
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

function isRuntimeLabelTier(tier: string): tier is RuntimeLabelTier {
  return tier === 'likely-test' || tier === 'standard' || tier === 'high-quality'
}

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
  score?: number
  tier?: RuntimeLabelTier
  profileIngestMode?: 'strict' | 'fallback' | 'missing'
}): void {
  logger.info(details, 'Processed Tap record')
}

function enqueueOrganizationRecompute(did: string, reason: string): void {
  enqueueRecomputeJob('recompute-org', did, {
    delayMs: RECOMPUTE_DEBOUNCE_MS,
    payload: { reason },
  })
}

function retryDelayForAttempt(attempts: number): number {
  const exponent = Math.max(0, attempts - 1)
  return Math.min(RECOMPUTE_MAX_RETRY_DELAY_MS, RECOMPUTE_DEBOUNCE_MS * (2 ** exponent))
}

function pendingDeleteRetryDelayForAttempt(attempts: number): number {
  const exponent = Math.max(0, attempts - 1)
  return Math.min(PENDING_DELETE_MAX_RETRY_MS, PENDING_DELETE_RETRY_BASE_MS * (2 ** exponent))
}

function buildHfText(
  profileSnapshot: ReturnType<typeof getProfileSnapshot>,
  organization: ActivityRecord,
  fallbackDisplayName: string,
): string {
  const profile = profileSnapshot?.payload
  const urlParts = (organization.urls ?? []).flatMap((item) => {
    const label = item.label?.trim()
    const url = item.url?.trim()
    return [label, url].filter((part): part is string => Boolean(part))
  })

  return [
    fallbackDisplayName,
    profile?.displayName,
    profile?.description,
    profile?.website,
    (organization.organizationType ?? []).join(' '),
    urlParts.join(' '),
  ]
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ')
}

function refreshHfClassification(did: string): void {
  const organization = getOrganizationSnapshot(did)
  if (!organization) return

  const profile = getProfileSnapshot(did)
  const merged = getMergedActorDisplay({
    did,
    profile: profile?.payload ?? null,
    organization: organization.payload,
  })
  const text = buildHfText(profile, organization.payload, merged.displayName)

  clearActivityHfFields(did, organization.rkey)
  enqueueClassification(text, did, organization.rkey)
}

type OrganizationRecomputeOutcome = {
  score: number
  tier: RuntimeLabelTier
  labelAction: 'applied' | 'unchanged' | 'negated-and-applied'
  profileIngestMode: 'strict' | 'fallback' | 'missing'
}

export async function recomputeLabeledOrganizationRow(did: string): Promise<OrganizationRecomputeOutcome | null> {
  if (hasPendingOrganizationDelete(did)) return null

  const organization = getOrganizationSnapshot(did)
  if (!organization) return null

  const profile = getProfileSnapshot(did)
  const scoringInput = buildMergedScoringInput({
    did,
    profile: profile?.payload ?? null,
    organization: organization.payload,
    profileValidationNotes: profile?.validationNotes ?? [],
  })
  scoringInput.urlResolution = getUrlResolutionMapForDid(did)
  const merged = getMergedActorDisplay({
    did,
    profile: profile?.payload ?? null,
    organization: organization.payload,
  })

  try {
    const result = await scoreActivity(scoringInput)

    try {
      logActivity({
        did,
        rkey: organization.rkey,
        uri: organization.recordUri,
        title: merged.displayName,
        score: result.totalScore,
        tier: result.tier,
        breakdown: JSON.stringify(result.breakdown),
        testSignals: JSON.stringify(result.testSignals),
        validationNotes: result.validationNotes,
        labeledAt: new Date().toISOString(),
      })
    } catch (err) {
      logger.error({ err, did, rkey: organization.rkey }, 'Error logging organization row')
      throw err
    }

    if (!isRuntimeLabelTier(result.tier)) {
      throw new Error(`Scoring produced unsupported runtime tier: ${result.tier}`)
    }

    const currentLabels = await fetchCurrentLabels(organization.recordUri)
    const currentQualityLabels = [...currentLabels].filter(isRuntimeLabelTier)
    const profileIngestMode = getProfileIngestMode(profile)
    const labelAction: OrganizationRecomputeOutcome['labelAction'] = currentQualityLabels.includes(result.tier)
      ? 'unchanged'
      : currentQualityLabels.length > 0
        ? 'negated-and-applied'
        : 'applied'

    try {
      if (labelAction !== 'unchanged') {
        await applyQualityLabel(organization.recordUri, result.tier)
      }
    } catch (err) {
      logger.error({ err, uri: organization.recordUri, did }, 'Error applying organization label (score still saved)')
      throw err
    }

    return {
      score: result.totalScore,
      tier: result.tier,
      labelAction,
      profileIngestMode,
    }
  } catch (err) {
    logger.error({ err, did, rkey: organization.rkey }, 'Error recomputing organization snapshot')
    throw err
  }
}

async function processPendingOrganizationDeletes(source: 'startup' | 'worker'): Promise<number> {
  const pendingDeletes = getPendingOrganizationDeletes()
  let processed = 0

  for (const pendingDelete of pendingDeletes) {
    try {
      logger.info(
        { did: pendingDelete.did, rkey: pendingDelete.rkey, uri: pendingDelete.record_uri, source },
        'Retrying pending organization label negation before cleanup',
      )
      const negatedCount = await negateQualityLabels(pendingDelete.record_uri)
      deleteOrganizationRecordState(pendingDelete.did, pendingDelete.rkey)
      deletePendingOrganizationDelete(pendingDelete.did)
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

  for (const snapshot of snapshots) {
    const outcome = await recomputeLabeledOrganizationRow(snapshot.did)
    if (outcome) {
      logRecordOutcome({
        did: snapshot.did,
        collection: ORGANIZATION_COLLECTION,
        action: 'reconcile',
        source: 'startup',
        score: outcome.score,
        tier: outcome.tier,
        labelAction: outcome.labelAction,
        profileIngestMode: outcome.profileIngestMode,
      })
    }
  }

  if (snapshots.length > 0) {
    logger.info({ count: snapshots.length }, 'Reconciled local organization snapshots on startup')
  } else {
    logger.info('No local organization snapshots found for startup reconciliation')
  }

  return snapshots.length
}

async function handleOrganizationDelete(did: string, rkey: string): Promise<void> {
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
}

async function handleProfileDelete(did: string): Promise<void> {
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
      if (parsed.success) {
        upsertProfileSnapshot({
          did: evt.did,
          recordUri: `at://${evt.did}/${PROFILE_COLLECTION}/${evt.rkey}`,
          rkey: evt.rkey,
          payload: parsed.value,
          validationNotes: [],
          updatedAt: new Date().toISOString(),
        })
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

        upsertProfileSnapshot({
          did: evt.did,
          recordUri: `at://${evt.did}/${PROFILE_COLLECTION}/${evt.rkey}`,
          rkey: evt.rkey,
          payload: fallback.profile as ProfileSnapshot['payload'],
          validationNotes: fallback.validationNotes,
          updatedAt: new Date().toISOString(),
        })
      }

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
  } finally {
    observeTapHandlerDuration(evt.collection, evt.action, performance.now() - startedAt)
  }
})

indexer.error((err) => {
  logger.error({ err }, 'SimpleIndexer error')
})

// Backfill HF classification for any activities that were ingested before HF was available
// or that failed classification previously. Uses the stored display name as a fallback.
export function backfillHfClassification(): void {
  // Re-evaluate existing HF results against current thresholds (catches threshold changes)
  const reclassified = reevaluateExistingClassifications()
  if (reclassified > 0) {
    logger.info({ count: reclassified }, 'Re-evaluated HF classifications against updated thresholds')
  }

  // Then backfill any that have no HF classification at all
  const unclassified = getUnclassifiedActivities()
  if (unclassified.length === 0) {
    logger.info('All activities have HF classification')
    return
  }
  logger.info({ count: unclassified.length }, 'Backfilling HF classification for unclassified activities')
  for (const { did, rkey, title } of unclassified) {
    // We only have the stored display name from the DB query — enqueue with that fallback text.
    enqueueClassification(title, did, rkey)
  }
}

export async function syncLabelsWithDb(): Promise<void> {
  const activities = getAllActivitiesForSync()
  let synced = 0

  for (const activity of activities) {
    try {
      const currentLabels = await fetchCurrentLabels(activity.uri)
      const currentQuality = [...currentLabels].filter(isRuntimeLabelTier)
      if (!isRuntimeLabelTier(activity.tier)) {
        continue
      }

      const dbTier = activity.tier as RuntimeLabelTier

      // If the ATProto label doesn't match the DB tier, update it
      if (!currentQuality.includes(dbTier)) {
        logger.info({ uri: activity.uri, dbTier, atprotoLabels: currentQuality }, 'Syncing mismatched label')
        await applyQualityLabel(activity.uri, dbTier)
        synced++
      }
    } catch (err) {
      logger.warn({ err, uri: activity.uri }, 'Failed to sync label, continuing')
    }
  }

  if (synced > 0) {
    logger.info({ count: synced }, 'Synced mismatched ATProto labels with DB tiers')
  } else {
    logger.info('All ATProto labels match DB tiers')
  }
}

/**
 * Starts the durable recompute loop that drains debounced actor jobs after Tap
 * events have been acknowledged. The worker performs scoring, label writes, and
 * pending delete cleanup outside the Tap handler.
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
          if (currentJob.kind !== 'recompute-org') {
            completeRecomputeJob(currentJob.id)
            job = claimDueRecomputeJob()
            continue
          }

          const outcome = await recomputeLabeledOrganizationRow(currentJob.key)
          if (outcome) {
            enqueueUrlChecksForDid(currentJob.key)
            refreshHfClassification(currentJob.key)
            logRecordOutcome({
              did: currentJob.key,
              collection: ORGANIZATION_COLLECTION,
              action: 'recompute',
              source: 'worker',
              score: outcome.score,
              tier: outcome.tier,
              labelAction: outcome.labelAction,
              profileIngestMode: outcome.profileIngestMode,
            })
          }

          completeRecomputeJob(currentJob.id)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (currentJob.attempts >= RECOMPUTE_MAX_ATTEMPTS) {
            logger.error({ err, job: currentJob }, 'Recompute job exceeded max attempts; leaving failed for inspection')
            failRecomputeJob(currentJob.id, message, RECOMPUTE_MAX_RETRY_DELAY_MS, 'failed')
          } else {
            const retryDelayMs = retryDelayForAttempt(currentJob.attempts)
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
