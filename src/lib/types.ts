import type { Main as OrganizationRecordBase } from '../lexicons/app/certified/actor/organization.defs'
import type { Main as ProfileRecordBase } from '../lexicons/app/certified/actor/profile.defs'
import type { MergedDisplayNameSource } from './scoring-input'

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

// Activity record used by ingestion and scoring.
export type ActivityRecord = OrganizationRecordBase

export interface ProfileSnapshot {
  did: string
  recordUri: string
  rkey: string
  payload: ProfileRecordBase
  updatedAt: string
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

// Scoring
// Active runtime tiers only. Legacy tiers are retained separately for stored rows and migration cleanup.
export type RuntimeLabelTier = 'likely-test' | 'standard' | 'high-quality'

// Legacy compatibility only — do not use for new runtime surfaces.
export type LegacyLabelTier = 'pending' | 'draft'

export type LabelTier = RuntimeLabelTier | LegacyLabelTier

export interface ScoreResult {
  totalScore: number       // final score: 0-100 completeness plus configured bonuses
  tier: LabelTier
  breakdown: ScoreBreakdown
  testSignals: string[]    // hard evidence that forces the likely-test label
}

export interface ScoreBreakdown {
  displayName: number
  description: number
  organizationType: number
  websitePresent: number
  websiteResolves: number
  websiteMatchesName: number
  organizationUrlsPresent: number
  organizationUrlsResolve: number
  locationValid: number
  foundedDateValid: number
  foundedDateAge: number
  avatar: number
  banner: number
  trustedPds: number       // bonus for actors hosted on configured trusted PDS hosts
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
  uri: string               // Organization record URI retained for dashboard links; labels target did.
  displayName: string
  score: number
  tier: LabelTier
  breakdown: string       // JSON-serialized ScoreBreakdown
  testSignals: string     // JSON-serialized string[]
  // Stored as JSON in SQLite, then deserialized into the in-memory/API string[] shape.
  validationNotes: string[]
  labeledAt: string       // ISO timestamp
  hfLabel?: string | null // HuggingFace classification label (nullable)
  hfScore?: number | null // HuggingFace classification confidence (nullable)
  // Legacy ingestion alias retained for the existing labeler caller until it migrates.
  title?: string
}

// Stats
export interface LabelStats {
  total: number
  byTier: Record<RuntimeLabelTier, number>
  last24h: number
  last7d: number
  hfCoverage: { classified: number; pending: number; total: number }
}
