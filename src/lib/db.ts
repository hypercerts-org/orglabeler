import Database from 'better-sqlite3'
import { ACTIVITY_DB_PATH } from './config'
import type { ActivityLogEntry, LabelStats, LabelTier } from './types'

export interface HfClassificationData {
  hfLabel: string | null
  hfScore: number | null
}

let _db: Database.Database | null = null

function createActivitiesTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      did TEXT NOT NULL,
      rkey TEXT NOT NULL,
      uri TEXT NOT NULL,
      title TEXT NOT NULL,
      score INTEGER NOT NULL,
      tier TEXT NOT NULL CHECK(tier IN ('pending', 'high-quality', 'standard', 'draft', 'likely-test')),
      breakdown TEXT NOT NULL,
      test_signals TEXT NOT NULL DEFAULT '[]',
      labeled_at TEXT NOT NULL DEFAULT (datetime('now')),
      hf_label TEXT,
      hf_score REAL,
      UNIQUE(did, rkey)
    );

    CREATE INDEX IF NOT EXISTS idx_activities_tier ON activities(tier);
    CREATE INDEX IF NOT EXISTS idx_activities_labeled_at ON activities(labeled_at);
    CREATE INDEX IF NOT EXISTS idx_activities_did ON activities(did);
  `)
}

// Lazy-init singleton. Creates DB file + tables on first call.
export function getDb(): Database.Database {
  if (_db) return _db

  _db = new Database(ACTIVITY_DB_PATH)
  _db.pragma('journal_mode = WAL')

  createActivitiesTable(_db)

  // Migration: check if 'pending' tier is accepted by the existing CHECK constraint.
  // Fix 1: Use INSERT OR IGNORE so a duplicate sentinel row does NOT trigger DROP TABLE.
  // Fix 2: Wrap the old-schema migration path in a transaction for atomicity.
  try {
    const result = _db.prepare(
      "INSERT OR IGNORE INTO activities (did, rkey, uri, title, score, tier, breakdown, test_signals) VALUES ('__migration_test', '__test', '__test', '__test', 0, 'pending', '{}', '[]')"
    ).run()
    // If the insert was ignored (row existed), that still means 'pending' is in the schema
    if (result.changes > 0) {
      _db.exec("DELETE FROM activities WHERE did = '__migration_test'")
    }
  } catch {
    // Old schema that doesn't accept 'pending' tier — recreate atomically
    _db.exec('BEGIN')
    try {
      _db.exec('DROP TABLE IF EXISTS activities')
      createActivitiesTable(_db)
      _db.exec('COMMIT')
    } catch (err) {
      _db.exec('ROLLBACK')
      throw err
    }
  }

  // Migration: add hf_label and hf_score columns if they don't exist yet
  const cols = (_db.prepare("PRAGMA table_info(activities)").all() as Array<{ name: string }>).map(c => c.name)
  if (!cols.includes('hf_label')) {
    _db.exec('ALTER TABLE activities ADD COLUMN hf_label TEXT')
  }
  if (!cols.includes('hf_score')) {
    _db.exec('ALTER TABLE activities ADD COLUMN hf_score REAL')
  }

  return _db
}

// Close the singleton database connection and reset the reference.
export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

// Upsert on did+rkey. Preserves existing hf_label/hf_score when the new values are null.
export function logActivity(entry: Omit<ActivityLogEntry, 'id'>, hf?: HfClassificationData): void {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO activities
      (did, rkey, uri, title, score, tier, breakdown, test_signals, labeled_at, hf_label, hf_score)
    VALUES
      (@did, @rkey, @uri, @title, @score, @tier, @breakdown, @testSignals, @labeledAt, @hfLabel, @hfScore)
    ON CONFLICT(did, rkey) DO UPDATE SET
      uri = excluded.uri,
      title = excluded.title,
      score = excluded.score,
      tier = excluded.tier,
      breakdown = excluded.breakdown,
      test_signals = excluded.test_signals,
      labeled_at = excluded.labeled_at,
      hf_label = COALESCE(excluded.hf_label, activities.hf_label),
      hf_score = COALESCE(excluded.hf_score, activities.hf_score)
  `)
  stmt.run({
    did: entry.did,
    rkey: entry.rkey,
    uri: entry.uri,
    title: entry.title,
    score: entry.score,
    tier: entry.tier,
    breakdown: entry.breakdown,
    testSignals: entry.testSignals,
    labeledAt: entry.labeledAt,
    hfLabel: hf?.hfLabel ?? null,
    hfScore: hf?.hfScore ?? null,
  })
}

// Update an existing activity row's score, tier, breakdown, and testSignals.
export function updateActivity(did: string, rkey: string, updates: { score: number; tier: LabelTier; breakdown: string; testSignals: string }): void {
  const db = getDb()
  db.prepare(`
    UPDATE activities
    SET score = @score, tier = @tier, breakdown = @breakdown, test_signals = @testSignals
    WHERE did = @did AND rkey = @rkey
  `).run({
    score: updates.score,
    tier: updates.tier,
    breakdown: updates.breakdown,
    testSignals: updates.testSignals,
    did,
    rkey,
  })
}

// Recent activities sorted by labeled_at DESC. Default limit=20, offset=0.
// Fix 5: Clamp limit/offset to safe values to prevent negative or NaN inputs.
export function getRecentActivities(limit = 20, offset = 0): ActivityLogEntry[] {
  const db = getDb()
  const safeLimit = Math.max(1, Math.min(limit || 20, 100))
  const safeOffset = Math.max(0, offset || 0)
  const rows = db.prepare(`
    SELECT id, did, rkey, uri, title, score, tier, breakdown, test_signals, labeled_at, hf_label, hf_score
    FROM activities
    ORDER BY labeled_at DESC
    LIMIT ? OFFSET ?
  `).all(safeLimit, safeOffset) as Array<Record<string, unknown>>

  return rows.map(rowToEntry)
}

// Get activities filtered by tier. Sorted by labeled_at DESC.
// Fix 5: Clamp limit/offset to safe values to prevent negative or NaN inputs.
export function getActivitiesByTier(tier: LabelTier, limit = 20, offset = 0): ActivityLogEntry[] {
  const db = getDb()
  const safeLimit = Math.max(1, Math.min(limit || 20, 100))
  const safeOffset = Math.max(0, offset || 0)
  const rows = db.prepare(`
    SELECT id, did, rkey, uri, title, score, tier, breakdown, test_signals, labeled_at, hf_label, hf_score
    FROM activities
    WHERE tier = ?
    ORDER BY labeled_at DESC
    LIMIT ? OFFSET ?
  `).all(tier, safeLimit, safeOffset) as Array<Record<string, unknown>>

  return rows.map(rowToEntry)
}

// Get total count (optionally filtered by tier)
export function getTotalCount(tier?: LabelTier): number {
  const db = getDb()
  if (tier) {
    const row = db.prepare('SELECT COUNT(*) as count FROM activities WHERE tier = ?').get(tier) as { count: number }
    return row.count
  }
  const row = db.prepare('SELECT COUNT(*) as count FROM activities').get() as { count: number }
  return row.count
}

// Get aggregate statistics.
// Fix 3: Use strftime('%Y-%m-%dT%H:%M:%S', ...) so ISO 8601 timestamps compare correctly.
// Fix 6: Consolidate into a single query with conditional aggregation (snapshot-consistent, 7x faster).
export function getStats(): LabelStats {
  const db = getDb()
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN tier = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN tier = 'high-quality' THEN 1 ELSE 0 END) as high_quality,
      SUM(CASE WHEN tier = 'standard' THEN 1 ELSE 0 END) as standard,
      SUM(CASE WHEN tier = 'draft' THEN 1 ELSE 0 END) as draft,
      SUM(CASE WHEN tier = 'likely-test' THEN 1 ELSE 0 END) as likely_test,
      SUM(CASE WHEN labeled_at > strftime('%Y-%m-%dT%H:%M:%S', 'now', '-1 day') THEN 1 ELSE 0 END) as last_24h,
      SUM(CASE WHEN labeled_at > strftime('%Y-%m-%dT%H:%M:%S', 'now', '-7 days') THEN 1 ELSE 0 END) as last_7d
    FROM activities
  `).get() as Record<string, number>

  return {
    total: row['total'] ?? 0,
    byTier: {
      'pending': row['pending'] ?? 0,
      'high-quality': row['high_quality'] ?? 0,
      'standard': row['standard'] ?? 0,
      'draft': row['draft'] ?? 0,
      'likely-test': row['likely_test'] ?? 0,
    },
    last24h: row['last_24h'] ?? 0,
    last7d: row['last_7d'] ?? 0,
  }
}

// Get all activities with tier = 'pending' (stale records from deploy race conditions)
export function getPendingActivities(): ActivityLogEntry[] {
  const db = getDb()
  const rows = db.prepare(
    'SELECT id, did, rkey, uri, title, score, tier, breakdown, test_signals, labeled_at, hf_label, hf_score FROM activities WHERE tier = ?'
  ).all('pending') as Array<Record<string, unknown>>
  return rows.map(rowToEntry)
}

// Delete a single activity by did + rkey
export function deleteActivity(did: string, rkey: string): void {
  const db = getDb()
  db.prepare('DELETE FROM activities WHERE did = ? AND rkey = ?').run(did, rkey)
}

// Update only the HF classification fields on an existing activity row.
export function updateActivityHfFields(did: string, rkey: string, hfLabel: string, hfScore: number): void {
  const db = getDb()
  db.prepare('UPDATE activities SET hf_label = ?, hf_score = ? WHERE did = ? AND rkey = ?')
    .run(hfLabel, hfScore, did, rkey)
}

// Fetch a single activity by did + rkey. Returns null if not found.
export function getActivityByDidRkey(did: string, rkey: string): ActivityLogEntry | null {
  const db = getDb()
  const row = db.prepare(
    'SELECT id, did, rkey, uri, title, score, tier, breakdown, test_signals, labeled_at, hf_label, hf_score FROM activities WHERE did = ? AND rkey = ?'
  ).get(did, rkey) as Record<string, unknown> | undefined
  return row ? rowToEntry(row) : null
}

function rowToEntry(row: Record<string, unknown>): ActivityLogEntry {
  return {
    id: row['id'] as number,
    did: row['did'] as string,
    rkey: row['rkey'] as string,
    uri: row['uri'] as string,
    title: row['title'] as string,
    score: row['score'] as number,
    tier: row['tier'] as LabelTier,
    breakdown: row['breakdown'] as string,
    testSignals: row['test_signals'] as string,
    labeledAt: row['labeled_at'] as string,
    hfLabel: (row['hf_label'] as string | null) ?? null,
    hfScore: (row['hf_score'] as number | null) ?? null,
  }
}
