import type { Main as OrganizationRecordBase } from '../lexicons/app/certified/actor/organization.defs'
import type { Main as LinearDocument } from '../lexicons/pub/leaflet/pages/linearDocument.defs'

// Organization record — re-exported from generated lexicon types
// The canonical shape is defined in lexicons/app/certified/actor/organization.json
export type { Main as OrganizationRecord } from '../lexicons/app/certified/actor/organization.defs'

// Backwards-compatible ingestion shape used by scoring code until that pipeline is migrated.
export type ActivityRecord = OrganizationRecordBase & {
  title?: string
  shortDescription?: string
  description?: LinearDocument
  image?: unknown
  workScope?: unknown
  contributors?: Array<{
    contributionWeight?: string
    contributionDetails?: unknown
  }>
  locations?: unknown[]
  startDate?: string
  endDate?: string
  rights?: unknown
}

// Scoring
export type LabelTier = 'pending' | 'high-quality' | 'standard' | 'draft' | 'likely-test'

export interface ScoreResult {
  totalScore: number       // 0-100 normalized
  tier: LabelTier
  breakdown: ScoreBreakdown
  testSignals: string[]    // reasons flagged as test data
}

export interface ScoreBreakdown {
  titleQuality: number       // 0-15
  shortDescQuality: number   // 0-15
  descriptionQuality: number // 0-20
  hasImage: number           // 0-10
  hasWorkScope: number       // 0-10
  contributorQuality: number // 0-15
  hasLocations: number       // 0-5
  hasDateRange: number       // 0-5
  hasRights: number          // 0-5
  repetitionFlags: number    // 0 = clean, negative penalty (-5 per signal, min -15)
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
  byTier: Record<LabelTier, number>
  last24h: number
  last7d: number
  hfCoverage: { classified: number; pending: number; total: number }
}
