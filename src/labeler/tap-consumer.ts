import { Tap, SimpleIndexer } from '@atproto/tap'
import type { TapChannel } from '@atproto/tap'
import { TAP_URL, TAP_ADMIN_PASSWORD, ACTIVITY_COLLECTION } from '../lib/config'
import { scoreActivity } from '../lib/scorer'
import {
  logActivity,
  getUnclassifiedActivities,
  getAllActivitiesForSync,
  getProfileSnapshot,
  getOrganizationSnapshot,
  getAllOrganizationSnapshots,
  deleteProfileSnapshot,
  deleteOrganizationRecordState,
  clearActivityHfFields,
  upsertProfileSnapshot,
  upsertOrganizationSnapshot,
} from '../lib/db'
import { enqueueClassification, reevaluateExistingClassifications } from '../lib/hf-classifier'
import { applyQualityLabel, fetchCurrentLabels, negateQualityLabels } from './server'
import { getMergedActorDisplay } from '../lib/actor-display'
import logger from './logger'
import type { ActivityRecord, RuntimeLabelTier } from '../lib/types'
import { $safeParse as $safeParseProfile } from '../lexicons/app/certified/actor/profile.defs'
import { $safeParse } from '../lexicons/app/certified/actor/organization.defs'

const tapConfig = TAP_ADMIN_PASSWORD ? { adminPassword: TAP_ADMIN_PASSWORD } : undefined
const tap = new Tap(TAP_URL, tapConfig)

const PROFILE_COLLECTION = 'app.certified.actor.profile'
const ORGANIZATION_COLLECTION = ACTIVITY_COLLECTION

const indexer = new SimpleIndexer()

function isRuntimeLabelTier(tier: string): tier is RuntimeLabelTier {
  return tier === 'likely-test' || tier === 'standard' || tier === 'high-quality'
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

export async function recomputeLabeledOrganizationRow(did: string): Promise<void> {
  const organization = getOrganizationSnapshot(did)
  if (!organization) return

  const profile = getProfileSnapshot(did)
  const merged = getMergedActorDisplay({
    did,
    profile: profile?.payload ?? null,
    organization: organization.payload,
  })

  let result
  try {
    result = scoreActivity(organization.payload as ActivityRecord)
  } catch (err) {
    logger.error({ err, did, rkey: organization.rkey }, 'Error scoring organization snapshot')
    return
  }

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
      labeledAt: new Date().toISOString(),
    })
    logger.info(
      { did, rkey: organization.rkey, score: result.totalScore, tier: result.tier },
      `Scored merged organization row: ${result.totalScore}/100 → ${result.tier}`
    )
  } catch (err) {
    logger.error({ err, did, rkey: organization.rkey }, 'Error logging organization row')
    return
  }

  try {
    await applyQualityLabel(organization.recordUri, result.tier)
  } catch (err) {
    logger.error({ err, uri: organization.recordUri, did }, 'Error applying organization label (score still saved)')
  }
}

export async function reconcileStoredOrganizationSnapshots(): Promise<number> {
  const snapshots = getAllOrganizationSnapshots()

  for (const snapshot of snapshots) {
    await recomputeLabeledOrganizationRow(snapshot.did)
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

  deleteOrganizationRecordState(did, rkey)

  try {
    await negateQualityLabels(recordUri)
  } catch (err) {
    logger.error({ err, did, rkey, uri: recordUri }, 'Error negating organization labels after delete')
  }
}

async function handleProfileDelete(did: string): Promise<void> {
  deleteProfileSnapshot(did)

  if (getOrganizationSnapshot(did)) {
    await recomputeLabeledOrganizationRow(did)
    refreshHfClassification(did)
  }
}

indexer.record(async (evt) => {
  if (evt.collection === PROFILE_COLLECTION) {
    if (evt.action === 'delete') {
      await handleProfileDelete(evt.did)
      logger.debug({ did: evt.did, rkey: evt.rkey }, 'Handled profile delete event')
      return
    }

    if (!evt.record) {
      logger.warn({ did: evt.did, rkey: evt.rkey, action: evt.action }, 'Skipping profile event with missing record payload')
      return
    }

    const parsed = $safeParseProfile(evt.record)
    if (!parsed.success) {
      logger.warn(
        { did: evt.did, rkey: evt.rkey, reason: parsed.reason?.message },
        'Profile record failed lexicon validation — skipping',
      )
      return
    }

    upsertProfileSnapshot({
      did: evt.did,
      recordUri: `at://${evt.did}/${PROFILE_COLLECTION}/${evt.rkey}`,
      rkey: evt.rkey,
      payload: parsed.value,
      updatedAt: new Date().toISOString(),
    })

    if (getOrganizationSnapshot(evt.did)) {
      await recomputeLabeledOrganizationRow(evt.did)
      refreshHfClassification(evt.did)
    }

    logger.debug({ did: evt.did, rkey: evt.rkey }, 'Stored profile snapshot')
    return
  }

  if (evt.collection !== ORGANIZATION_COLLECTION) return

  if (evt.action === 'delete') {
    await handleOrganizationDelete(evt.did, evt.rkey)
    logger.debug({ did: evt.did, rkey: evt.rkey }, 'Handled organization delete event')
    return
  }

  if (!evt.record) {
    logger.warn({ did: evt.did, rkey: evt.rkey, action: evt.action }, 'Skipping organization event with missing record payload')
    return
  }

  // Validate against the app.certified.actor.organization lexicon
  const parsed = $safeParse(evt.record)
  if (!parsed.success) {
    logger.warn(
      { did: evt.did, rkey: evt.rkey, reason: parsed.reason?.message },
      'Record failed lexicon validation — skipping',
    )
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

  await recomputeLabeledOrganizationRow(evt.did)
  refreshHfClassification(evt.did)
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

export function startTapConsumer(): { channel: TapChannel; destroy: () => Promise<void> } {
  const channel = tap.channel(indexer)
  // channel.start() returns a promise that resolves when destroyed - do NOT await it
  channel.start().catch((err) => {
    logger.error({ err }, 'Tap channel fatal error — exiting')
    process.exit(1)
  })
  return {
    channel,
    destroy: () => channel.destroy(),
  }
}
