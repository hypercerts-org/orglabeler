import type { Main as OrganizationRecordBase } from '../lexicons/app/certified/actor/organization.defs'
import type { Main as ProfileRecordBase } from '../lexicons/app/certified/actor/profile.defs'
import type { MergedDisplayNameSource } from './actor-evidence'

// Organization record — re-exported from generated lexicon types
// The canonical shape is defined in lexicons/app/certified/actor/organization.json
export type { Main as OrganizationRecord } from '../lexicons/app/certified/actor/organization.defs'

// Profile record — re-exported from generated lexicon types.
export type { Main as ProfileRecord } from '../lexicons/app/certified/actor/profile.defs'

export interface MergedActorInput {
  did: string
  profile: ProfileRecordBase | null
  organization: OrganizationRecordBase | null
}

export interface MergedActorOutput extends MergedActorInput {
  displayName: string
  displayNameSource: MergedDisplayNameSource
  hasProfileDescription: boolean
  hasWebsite: boolean
  hasAvatar: boolean
  websiteHostname: string | null
}

// Activity record used by ingestion and assessment evidence.
export type ActivityRecord = OrganizationRecordBase

export interface ProfileSnapshot {
  did: string
  recordUri: string
  rkey: string
  payload: ProfileRecordBase
  updatedAt: string
}

export type JevAssessmentStatus =
  | 'queued'
  | 'assessing'
  | 'assessed'
  | 'uncertain'
  | 'awaiting-configuration'
  | 'awaiting-pds-resolution'
  | 'failed'
  | 'legacy-stale'

export type PublishedLabelStatus = 'none' | 'current' | 'stale'

export interface JevAssessmentRecord {
  did: string
  rkey: string
  uri: string
  displayName: string
  inputIdentity: string
  resultInputIdentity: string | null
  model: string | null
  questionVersion: string | null
  policyVersion: string | null
  probabilities: Record<string, unknown> | null
  status: JevAssessmentStatus
  publishedTier: RuntimeLabelTier | null
  labelStatus: PublishedLabelStatus
  lastError: string | null
  updatedAt: string
  assessedAt: string | null
}

export interface ReassessmentRun {
  id: string
  status: 'running' | 'completed'
  startedByDid: string
  total: number
  completed: number
  failed: number
  skipped: number
  startedAt: string
  finishedAt: string | null
}

export type ProfileFallbackMode = 'fallback' | 'unusable'

export type ProfileFallbackMedia =
  | {
      $type?: string
      uri: string
      image?: never
    }
  | {
      $type?: string
      image: Record<string, unknown>
      uri?: never
    }

export interface ProfileFallbackProfile {
  displayName: string | null
  description: string | null
  website: string | null
  createdAt: string | null
  avatar: ProfileFallbackMedia | null
  banner: ProfileFallbackMedia | null
}

export interface ProfileFallbackUsableResult {
  mode: 'fallback'
  profile: ProfileFallbackProfile
  validationNotes: string[]
}

export interface ProfileFallbackUnusableResult {
  mode: 'unusable'
  validationNotes: string[]
}

export type ProfileFallbackResult = ProfileFallbackUsableResult | ProfileFallbackUnusableResult

export interface OrganizationSnapshot {
  did: string
  recordUri: string
  rkey: string
  payload: OrganizationRecordBase
  updatedAt: string
}

export type RuntimeLabelTier = 'likely-test' | 'standard' | 'high-quality'

export interface LabelDefinition {
  identifier: string
  locales: Array<{ lang: string; name: string; description: string }>
}

export interface AssessmentFeedEntry extends Omit<JevAssessmentRecord, 'inputIdentity' | 'resultInputIdentity' | 'lastError'> {
  validationNotes: string[]
}

export interface LabelStats {
  total: number
  byTier: Record<RuntimeLabelTier, number>
  byAssessmentStatus: Record<JevAssessmentStatus, number>
  staleLabels: number
  last24h: number
  last7d: number
}
