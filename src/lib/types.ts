// Activity record — re-exported from generated lexicon types
// The canonical shape is defined in lexicons/org/hypercerts/claim/activity.json
export type { Main as ActivityRecord } from '../lexicons/org/hypercerts/claim/activity.defs'
export type { Contributor as ActivityContributor } from '../lexicons/org/hypercerts/claim/activity.defs'

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
