import { createHash } from 'node:crypto'

import {
  JEV_POLICY_VERSION,
  JEV_QUESTION_VERSION,
  fetchJevAssessment,
  type JevAssessmentState,
  type JevFetch,
  type JevJsonValue,
} from '../lib/jev'
import {
  JEV_MAX_TEST_PROBABILITY_FOR_QUALITY,
  JEV_MODEL,
  JEV_PURPOSE_THRESHOLD,
  JEV_QUALITY_THRESHOLD,
  JEV_TEST_THRESHOLD,
  TEST_PDS_HOSTS,
  TYPESAFE_API_KEY,
} from '../lib/config'
import { withDidLock } from '../lib/did-lock'
import {
  enqueueRecomputeJob,
  getActorPdsCache,
  getOrganizationSnapshot,
  getProfileSnapshot,
  getUrlResolutionMap,
  hasPendingOrganizationDelete,
  getJevAssessment,
  getAllOrganizationSnapshots,
  initializeJevAssessment,
  isActorPdsCacheStale,
  saveJevAssessment,
  setJevAssessmentStatus,
  updateReassessmentRunItem,
  type ActorPdsCache,
} from '../lib/db'
import { getMergedActorDisplay } from '../lib/actor-display'
import { isConfiguredTestPdsHost, normalizePdsHost } from '../lib/pds-utils'
import { normalizePublicWebsiteUrl } from '../lib/website-utils'
import { enqueueActorPdsResolution } from '../lib/actor-pds-policy'
import logger from './logger'

interface AssessmentContext {
  state: JevAssessmentState
  inputIdentity: string
  actorPdsCache: ActorPdsCache | null
  pdsHost: string | null
}

export interface QueueAssessmentOptions {
  delayMs?: number
  force?: boolean
  runIds?: string[]
}

export interface ProcessAssessmentOptions {
  force?: boolean
  runIds?: string[]
  fetchImpl?: JevFetch
}

export type ProcessAssessmentOutcome =
  | 'assessed'
  | 'uncertain'
  | 'cached'
  | 'awaiting-configuration'
  | 'awaiting-pds-resolution'
  | 'stale'
  | 'deleted'

/** Queues the latest saved actor context without doing inference in the Tap handler. */
export function queueOrganizationAssessment(
  did: string,
  reason: string,
  options: QueueAssessmentOptions = {},
): boolean {
  if (hasPendingOrganizationDelete(did)) return false
  const organization = getOrganizationSnapshot(did)
  const context = buildAssessmentContext(did)
  if (!organization || !context) return false

  initializeJevAssessment({
    did,
    rkey: organization.rkey,
    uri: organization.recordUri,
    displayName: context.state.displayName,
    inputIdentity: context.inputIdentity,
  })
  enqueueRecomputeJob('recompute-org', did, {
    delayMs: options.delayMs ?? 0,
    payload: {
      reason,
      ...(options.force ? { force: true } : {}),
      ...(options.runIds?.length ? { runIds: options.runIds } : {}),
    },
  })
  return true
}

/** Requeues saved inputs that have no result for their current evidence and policy versions. */
export function queueSavedOrganizationsNeedingAssessment(): number {
  let queued = 0
  for (const snapshot of getAllOrganizationSnapshots()) {
    const context = buildAssessmentContext(snapshot.did)
    if (!context) continue

    const existing = getJevAssessment(snapshot.did)
    const resultIsCurrent = existing?.resultInputIdentity === context.inputIdentity
      && existing.questionVersion === JEV_QUESTION_VERSION
      && existing.policyVersion === JEV_POLICY_VERSION
      && (existing.status === 'assessed' || existing.status === 'uncertain')

    if (resultIsCurrent) continue
    if (queueOrganizationAssessment(snapshot.did, 'startup-assessment-catchup')) queued++
  }
  return queued
}

/** Runs one durable actor assessment. The provider is contacted only after PDS policy checks. */
export async function processOrganizationAssessment(
  did: string,
  options: ProcessAssessmentOptions = {},
): Promise<ProcessAssessmentOutcome> {
  const runIds = uniqueRunIds(options.runIds ?? [])
  if (hasPendingOrganizationDelete(did)) {
    finishRunItems(runIds, did, 'skipped')
    return 'deleted'
  }

  const context = buildAssessmentContext(did)
  if (!context) {
    finishRunItems(runIds, did, 'skipped')
    return 'deleted'
  }

  const organization = getOrganizationSnapshot(did)
  if (!organization) {
    finishRunItems(runIds, did, 'skipped')
    return 'deleted'
  }

  initializeJevAssessment({
    did,
    rkey: organization.rkey,
    uri: organization.recordUri,
    displayName: context.state.displayName,
    inputIdentity: context.inputIdentity,
  })
  finishRunItems(runIds, did, 'running')

  const pds = configuredTestPdsDecision(context.actorPdsCache)
  if (pds.kind === 'awaiting-resolution') {
    setJevAssessmentStatus(did, 'awaiting-pds-resolution')
    enqueueActorPdsResolution(did, 'jev-test-pds-override', 0, {
      force: options.force,
      runIds,
    })
    finishRunItems(runIds, did, 'pending')
    return 'awaiting-pds-resolution'
  }

  if (pds.kind === 'test-pds') {
    return publishIfCurrent(did, context, runIds, {
      model: null,
      probabilities: {
        source: 'configured-test-pds',
        pdsHost: pds.host,
      },
      tier: 'likely-test',
      status: 'assessed',
    })
  }

  const existing = getJevAssessment(did)
  const resultIsCurrent = existing?.resultInputIdentity === context.inputIdentity
    && existing.questionVersion === JEV_QUESTION_VERSION
    && existing.policyVersion === JEV_POLICY_VERSION
    && (existing.status === 'assessed' || existing.status === 'uncertain')
  if (resultIsCurrent && !options.force) {
    finishRunItems(runIds, did, 'completed')
    return 'cached'
  }

  if (!TYPESAFE_API_KEY) {
    setJevAssessmentStatus(did, 'awaiting-configuration')
    finishRunItems(runIds, did, runIds.length > 0 ? 'failed' : 'pending')
    return 'awaiting-configuration'
  }

  setJevAssessmentStatus(did, 'assessing')
  try {
    const result = await fetchJevAssessment(context.state, {
      fetchImpl: options.fetchImpl,
    })

    if (result.decision.kind === 'uncertain') {
      return publishIfCurrent(did, context, runIds, {
        model: result.model,
        probabilities: result.answers,
        tier: null,
        status: 'uncertain',
      })
    }

    return publishIfCurrent(did, context, runIds, {
      model: result.model,
      probabilities: result.answers,
      tier: result.decision.tier,
      status: 'assessed',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Jev assessment failed'
    setJevAssessmentStatus(did, 'failed', message)
    logger.warn({ did, error: message }, 'Jev assessment failed; durable job will retry')
    throw error
  }
}

async function publishIfCurrent(
  did: string,
  initialContext: AssessmentContext,
  runIds: string[],
  result: {
    model: string | null
    probabilities: object
    tier: 'likely-test' | 'standard' | 'high-quality' | null
    status: 'assessed' | 'uncertain'
  },
): Promise<ProcessAssessmentOutcome> {
  return withDidLock(did, async () => {
    if (hasPendingOrganizationDelete(did)) {
      finishRunItems(runIds, did, 'skipped')
      return 'deleted'
    }

    const currentContext = buildAssessmentContext(did)
    if (!currentContext) {
      finishRunItems(runIds, did, 'skipped')
      return 'deleted'
    }

    if (currentContext.inputIdentity !== initialContext.inputIdentity) {
      queueOrganizationAssessment(did, 'assessment-input-changed-during-inference', {
        force: runIds.length > 0,
        runIds,
      })
      finishRunItems(runIds, did, 'pending')
      return 'stale'
    }

    const organization = getOrganizationSnapshot(did)
    if (!organization) {
      finishRunItems(runIds, did, 'skipped')
      return 'deleted'
    }

    if (result.tier) {
      const { applyQualityLabel } = await import('./server')
      await applyQualityLabel(did, result.tier)
    }

    const saved = saveJevAssessment({
      did,
      inputIdentity: initialContext.inputIdentity,
      model: result.model,
      questionVersion: JEV_QUESTION_VERSION,
      policyVersion: JEV_POLICY_VERSION,
      probabilities: result.probabilities,
      status: result.status,
      tier: result.tier,
    })

    if (!saved) {
      if (!hasPendingOrganizationDelete(did) && getOrganizationSnapshot(did)) {
        queueOrganizationAssessment(did, 'assessment-result-became-stale', {
          force: runIds.length > 0,
          runIds,
        })
        finishRunItems(runIds, did, 'pending')
        return 'stale'
      }
      finishRunItems(runIds, did, 'skipped')
      return 'deleted'
    }

    finishRunItems(runIds, did, 'completed')
    return result.status === 'uncertain' ? 'uncertain' : 'assessed'
  })
}

function buildAssessmentContext(did: string): AssessmentContext | null {
  const organization = getOrganizationSnapshot(did)
  if (!organization) return null

  const profile = getProfileSnapshot(did)
  const merged = getMergedActorDisplay({
    did,
    profile: profile?.payload ?? null,
    organization: organization.payload,
  })
  const urls = collectUrlEvidence(profile?.payload.website, organization.payload.urls)
  const normalizedUrls = urls
    .map(item => normalizePublicWebsiteUrl(item.url))
    .filter((url): url is string => Boolean(url))
  const resolutions = getUrlResolutionMap(normalizedUrls)
  const urlEvidence = urls.map(item => {
    const normalizedUrl = normalizePublicWebsiteUrl(item.url)
    return {
      ...item,
      status: (normalizedUrl ? resolutions[normalizedUrl] : undefined) ?? 'unknown' as const,
    }
  })
  const actorPdsCache = getActorPdsCache(did)
  const pdsHost = actorPdsCache?.pdsHost ? normalizePdsHost(actorPdsCache.pdsHost) : null
  const state: JevAssessmentState = {
    did,
    displayName: merged.displayName,
    profileRecord: profile ? asJevObject(profile.payload) : null,
    organizationRecord: asJevObject(organization.payload),
    urlEvidence,
  }
  const identityMaterial = {
    model: JEV_MODEL,
    questionVersion: JEV_QUESTION_VERSION,
    policyVersion: JEV_POLICY_VERSION,
    decisionPolicy: {
      testThreshold: JEV_TEST_THRESHOLD,
      maxTestProbabilityForQuality: JEV_MAX_TEST_PROBABILITY_FOR_QUALITY,
      purposeThreshold: JEV_PURPOSE_THRESHOLD,
      qualityThreshold: JEV_QUALITY_THRESHOLD,
      testPdsHosts: [...TEST_PDS_HOSTS].sort(),
    },
    state,
    actorPds: TEST_PDS_HOSTS.length > 0
      ? { status: actorPdsCache?.status ?? 'missing', host: pdsHost }
      : null,
  }
  const inputIdentity = createHash('sha256').update(stableJson(identityMaterial)).digest('hex')

  return { state, inputIdentity, actorPdsCache, pdsHost }
}

function collectUrlEvidence(
  profileWebsite: string | undefined,
  organizationUrls: Array<{ url?: string; label?: string } | null> | undefined,
): JevAssessmentState['urlEvidence'] {
  const values: Array<{ source: string; url: string }> = []
  if (typeof profileWebsite === 'string' && profileWebsite.trim()) {
    values.push({ source: 'profile.website', url: profileWebsite.trim().slice(0, 2048) })
  }

  for (const [index, item] of (organizationUrls ?? []).entries()) {
    if (typeof item?.url === 'string' && item.url.trim()) {
      values.push({ source: `organization.urls[${index}]`, url: item.url.trim().slice(0, 2048) })
    }
  }

  return values.map(item => ({ ...item, status: 'unknown' }))
}

function configuredTestPdsDecision(cache: ActorPdsCache | null):
  | { kind: 'not-configured' }
  | { kind: 'awaiting-resolution' }
  | { kind: 'test-pds'; host: string } {
  if (TEST_PDS_HOSTS.length === 0) return { kind: 'not-configured' }
  if (!cache || cache.status !== 'ok' || !cache.pdsHost || isActorPdsCacheStale(cache)) {
    return { kind: 'awaiting-resolution' }
  }

  const host = normalizePdsHost(cache.pdsHost)
  if (!host) return { kind: 'awaiting-resolution' }
  return isConfiguredTestPdsHost(host, TEST_PDS_HOSTS)
    ? { kind: 'test-pds', host }
    : { kind: 'not-configured' }
}

function asJevObject(value: unknown): { [key: string]: JevJsonValue } {
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as { [key: string]: JevJsonValue }
      : {}
  } catch {
    return {}
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function uniqueRunIds(runIds: string[]): string[] {
  return [...new Set(runIds.filter(id => typeof id === 'string' && id.length > 0))]
}

function finishRunItems(
  runIds: string[],
  did: string,
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped',
): void {
  for (const runId of runIds) {
    updateReassessmentRunItem(runId, did, status)
  }
}
