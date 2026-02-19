import Database from 'better-sqlite3'
import { ACTIVITY_DB_PATH } from './config'
import type { ActivityLogEntry, LabelStats, LabelTier } from './types'

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
  // If not (old 4-tier schema), recreate the table preserving existing data.
  try {
    _db.exec("INSERT INTO activities (did, rkey, uri, title, score, tier, breakdown, test_signals) VALUES ('__migration_test', '__test', '__test', '__test', 0, 'pending', '{}', '[]')")
    _db.exec("DELETE FROM activities WHERE did = '__migration_test'")
  } catch {
    // Old schema — recreate table with new CHECK constraint
    _db.exec('DROP TABLE IF EXISTS activities')
    createActivitiesTable(_db)
  }

  return _db
}

// Insert or replace (upsert on did+rkey). Does not throw on duplicates.
export function logActivity(entry: Omit<ActivityLogEntry, 'id'>): void {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO activities
      (did, rkey, uri, title, score, tier, breakdown, test_signals, labeled_at)
    VALUES
      (@did, @rkey, @uri, @title, @score, @tier, @breakdown, @testSignals, @labeledAt)
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
export function getRecentActivities(limit = 20, offset = 0): ActivityLogEntry[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT id, did, rkey, uri, title, score, tier, breakdown, test_signals, labeled_at
    FROM activities
    ORDER BY labeled_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Array<Record<string, unknown>>

  return rows.map(rowToEntry)
}

// Get activities filtered by tier. Sorted by labeled_at DESC.
export function getActivitiesByTier(tier: LabelTier, limit = 20, offset = 0): ActivityLogEntry[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT id, did, rkey, uri, title, score, tier, breakdown, test_signals, labeled_at
    FROM activities
    WHERE tier = ?
    ORDER BY labeled_at DESC
    LIMIT ? OFFSET ?
  `).all(tier, limit, offset) as Array<Record<string, unknown>>

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

// Get aggregate statistics
export function getStats(): LabelStats {
  const db = getDb()

  const total = (db.prepare('SELECT COUNT(*) as count FROM activities').get() as { count: number }).count

  const pending = (db.prepare("SELECT COUNT(*) as count FROM activities WHERE tier = 'pending'").get() as { count: number }).count
  const highQuality = (db.prepare("SELECT COUNT(*) as count FROM activities WHERE tier = 'high-quality'").get() as { count: number }).count
  const standard = (db.prepare("SELECT COUNT(*) as count FROM activities WHERE tier = 'standard'").get() as { count: number }).count
  const draft = (db.prepare("SELECT COUNT(*) as count FROM activities WHERE tier = 'draft'").get() as { count: number }).count
  const likelyTest = (db.prepare("SELECT COUNT(*) as count FROM activities WHERE tier = 'likely-test'").get() as { count: number }).count

  const last24h = (db.prepare("SELECT COUNT(*) as count FROM activities WHERE labeled_at > datetime('now', '-1 day')").get() as { count: number }).count
  const last7d = (db.prepare("SELECT COUNT(*) as count FROM activities WHERE labeled_at > datetime('now', '-7 days')").get() as { count: number }).count

  return {
    total,
    byTier: {
      'pending': pending,
      'high-quality': highQuality,
      'standard': standard,
      'draft': draft,
      'likely-test': likelyTest,
    },
    last24h,
    last7d,
  }
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
  }
}
