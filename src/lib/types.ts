import type { Main as OrganizationRecordBase } from '../lexicons/app/certified/actor/organization.defs'
import type { Main as ProfileRecordBase } from '../lexicons/app/certified/actor/profile.defs'
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
  hasProfileDescription: boolean
  hasWebsite: boolean
  hasAvatar: boolean
  websiteHostname: string | null
}

// Activity record used by ingestion and scoring.
export type ActivityRecord = OrganizationRecordBase

export interface ProfileSnapshot {
  did: string
  recordUri: string
  rkey: string
  payload: ProfileRecordBase
  updatedAt: string
}

export interface OrganizationSnapshot {
  did: string
  recordUri: string
  rkey: string
  payload: OrganizationRecordBase
  updatedAt: string
}

// Scoring
// Active runtime tiers only. Legacy tiers are retained separately for stored rows and migration cleanup.
export type RuntimeLabelTier = 'likely-test' | 'standard' | 'high-quality'

// Legacy compatibility only — do not use for new runtime surfaces.
export type LegacyLabelTier = 'pending' | 'draft'

export type LabelTier = RuntimeLabelTier | LegacyLabelTier

export interface ScoreResult {
  totalScore: number       // 0-100 normalized
  tier: LabelTier
  breakdown: ScoreBreakdown
  testSignals: string[]    // reasons flagged as test data
}

export interface ScoreBreakdown {
  organizationType: number
  urls: number
  location: number
  foundedDate: number
  createdAt: number

  // Legacy compatibility aliases for the existing dashboard breakdown view.
  titleQuality: number
  shortDescQuality: number
  descriptionQuality: number
  hasImage: number
  hasWorkScope: number
  contributorQuality: number
  hasLocations: number
  hasDateRange: number
  hasRights: number
  repetitionFlags: number
}

export interface LabelDefinition {
  identifier: string
  locales: Array<{ lang: string; name: string; description: string }>
}

// Activity log entry (stored in SQLite)
export interface ActivityLogEntry {
  id?: number
  did: string
  rkey: string
  uri: string
  title: string
  score: number
  tier: LabelTier
  breakdown: string       // JSON-serialized ScoreBreakdown
  testSignals: string     // JSON-serialized string[]
  labeledAt: string       // ISO timestamp
  hfLabel?: string | null // HuggingFace classification label (nullable)
  hfScore?: number | null // HuggingFace classification confidence (nullable)
}

// Stats
export interface LabelStats {
  total: number
  byTier: Record<RuntimeLabelTier, number>
  last24h: number
  last7d: number
  hfCoverage: { classified: number; pending: number; total: number }
}
