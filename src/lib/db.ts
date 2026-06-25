import Database from 'better-sqlite3'
import { ACTIVITY_DB_PATH } from './config'
import type {
  ActivityLogEntry,
  LabelStats,
  LabelTier,
  OrganizationSnapshot,
  ProfileSnapshot,
  RuntimeLabelTier,
} from './types'
import type { UrlResolutionMap, UrlResolutionState } from './scoring-input'

export const HF_POSITIVE_LABEL = 'well-formed actor profile'

export interface HfClassificationData {
  hfLabel: string | null
  hfScore: number | null
}

type SnapshotInput<TPayload> = {
  did: string
  recordUri: string
  rkey: string
  payload: TPayload
  updatedAt?: string
  validationNotes?: string[]
}

interface SnapshotRecord<TPayload> {
  did: string
  recordUri: string
  rkey: string
  payload: TPayload
  updatedAt: string
  validationNotes?: string[]
}

interface SnapshotRow {
  did: string
  record_uri: string
  rkey: string
  payload: string
  updated_at: string
  validation_notes?: string | null
}

interface PendingOrganizationDeleteRow {
  did: string
  record_uri: string
  rkey: string
  attempts: number
  last_attempt_at: string | null
  next_attempt_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type RecomputeJobKind = 'recompute-org' | 'resolve-actor-pds'
export type RecomputeJobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface RecomputeJob {
  id: number
  kind: RecomputeJobKind
  key: string
  status: RecomputeJobStatus
  attempts: number
  runAfter: string
  payload: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

interface RecomputeJobRow {
  id: number
  kind: string
  key: string
  status: string
  attempts: number
  run_after: string
  payload: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type ActorPdsCacheStatus = 'pending' | 'ok' | 'failed'

/** Cached DID → PDS resolution state used by test-PDS labeling and URL gating. */
export interface ActorPdsCache {
  did: string
  status: ActorPdsCacheStatus
  pdsUrl: string | null
  pdsHost: string | null
  checkedAt: string | null
  expiresAt: string
  lastError: string | null
  createdAt: string
  updatedAt: string
}

interface ActorPdsCacheRow {
  did: string
  status: string
  pds_url: string | null
  pds_host: string | null
  checked_at: string | null
  expires_at: string
  last_error: string | null
  created_at: string
  updated_at: string
}

/** Durable URL cache status. Pending means scoring should keep optimistic provisional URL points. */
export type UrlCheckStatus = 'pending' | 'ok' | 'failed'

/** URL cache row used by the async URL enrichment worker. */
export interface UrlCheck {
  normalizedUrl: string
  status: UrlCheckStatus
  resolvable: boolean | null
  statusCode: number | null
  error: string | null
  attempts: number
  lastAttemptAt: string | null
  checkedAt: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
}

interface UrlCheckRow {
  normalized_url: string
  status: string
  resolvable: number | null
  status_code: number | null
  error: string | null
  attempts: number
  last_attempt_at: string | null
  checked_at: string | null
  expires_at: string
  created_at: string
  updated_at: string
}

type ActivityLogInput = {
  did: string
  rkey: string
  uri: string
  displayName?: string
  title?: string
  score: number
  tier: LabelTier
  breakdown: string
  testSignals: string
  validationNotes?: string[]
  labeledAt: string
  hfLabel?: string | null
  hfScore?: number | null
}

const ACTIVITY_SELECT_COLUMNS = `id, did, rkey, uri, title AS displayName, score, tier, breakdown, test_signals, validation_notes, labeled_at, hf_label, hf_score`

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
      tier TEXT NOT NULL CHECK(tier IN ('likely-test', 'standard', 'high-quality')),
      breakdown TEXT NOT NULL,
      test_signals TEXT NOT NULL DEFAULT '[]',
      validation_notes TEXT NOT NULL DEFAULT '[]',
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

function createRecomputeJobsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recompute_jobs (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'done', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      run_after TEXT NOT NULL,
      payload TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(kind, key)
    );

    CREATE INDEX IF NOT EXISTS idx_recompute_jobs_due ON recompute_jobs(status, run_after);
    CREATE INDEX IF NOT EXISTS idx_recompute_jobs_updated_at ON recompute_jobs(updated_at);
  `)
}

function createActorPdsCacheTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS actor_pds_cache (
      did TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('pending', 'ok', 'failed')),
      pds_url TEXT,
      pds_host TEXT,
      checked_at TEXT,
      expires_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_actor_pds_cache_status_expires ON actor_pds_cache(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_actor_pds_cache_host ON actor_pds_cache(pds_host);
  `)
}

function createUrlChecksTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS url_checks (
      normalized_url TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('pending', 'ok', 'failed')),
      resolvable INTEGER,
      status_code INTEGER,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      checked_at TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_url_checks_due ON url_checks(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_url_checks_updated_at ON url_checks(updated_at);
  `)
}

function createSnapshotTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_snapshots (
      did TEXT PRIMARY KEY,
      record_uri TEXT NOT NULL,
      rkey TEXT NOT NULL,
      payload TEXT NOT NULL,
      validation_notes TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_profile_snapshots_updated_at ON profile_snapshots(updated_at);

    CREATE TABLE IF NOT EXISTS organization_snapshots (
      did TEXT PRIMARY KEY,
      record_uri TEXT NOT NULL,
      rkey TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_organization_snapshots_updated_at ON organization_snapshots(updated_at);

    CREATE TABLE IF NOT EXISTS pending_organization_deletes (
      did TEXT PRIMARY KEY,
      record_uri TEXT NOT NULL,
      rkey TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      next_attempt_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pending_organization_deletes_updated_at ON pending_organization_deletes(updated_at);
  `)
}

// Lazy-init singleton. Creates DB file + tables on first call.
export function getDb(): Database.Database {
  if (_db) return _db

  _db = new Database(ACTIVITY_DB_PATH)
  _db.pragma('journal_mode = WAL')

  createActivitiesTable(_db)
  createSnapshotTables(_db)
  createRecomputeJobsTable(_db)
  createActorPdsCacheTable(_db)
  createUrlChecksTable(_db)

  // Migration: recreate tables whose tier CHECK constraint predates the active 3-tier set.
  try {
    const row = _db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'activities'").get() as { sql?: string } | undefined
    const expectedCheck = "CHECK(tier IN ('likely-test', 'standard', 'high-quality'))"
    if (!row?.sql?.includes(expectedCheck)) {
      // Old schema — recreate atomically so new writes only allow active runtime tiers.
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
  } catch {
    // If schema introspection fails, fall back to a clean rebuild.
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
  if (!cols.includes('validation_notes')) {
    _db.exec("ALTER TABLE activities ADD COLUMN validation_notes TEXT NOT NULL DEFAULT '[]'")
  }

  const profileCols = (_db.prepare("PRAGMA table_info(profile_snapshots)").all() as Array<{ name: string }>).map(c => c.name)
  if (!profileCols.includes('validation_notes')) {
    _db.exec("ALTER TABLE profile_snapshots ADD COLUMN validation_notes TEXT NOT NULL DEFAULT '[]'")
  }

  const pendingDeleteCols = (_db.prepare("PRAGMA table_info(pending_organization_deletes)").all() as Array<{ name: string }>).map(c => c.name)
  if (!pendingDeleteCols.includes('next_attempt_at')) {
    _db.exec('ALTER TABLE pending_organization_deletes ADD COLUMN next_attempt_at TEXT')
  }
  _db.exec('CREATE INDEX IF NOT EXISTS idx_pending_organization_deletes_next_attempt ON pending_organization_deletes(next_attempt_at)')

  return _db
}

// Close the singleton database connection and reset the reference.
export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

function upsertSnapshot<TPayload>(
  table: 'profile_snapshots' | 'organization_snapshots',
  snapshot: SnapshotInput<TPayload>,
): void {
  const db = getDb()

  if (table === 'profile_snapshots') {
    db.prepare(`
      INSERT INTO profile_snapshots (did, record_uri, rkey, payload, validation_notes, updated_at)
      VALUES (@did, @recordUri, @rkey, @payload, @validationNotes, @updatedAt)
      ON CONFLICT(did) DO UPDATE SET
        record_uri = excluded.record_uri,
        rkey = excluded.rkey,
        payload = excluded.payload,
        validation_notes = excluded.validation_notes,
        updated_at = excluded.updated_at
    `).run({
      did: snapshot.did,
      recordUri: snapshot.recordUri,
      rkey: snapshot.rkey,
      payload: JSON.stringify(snapshot.payload),
      validationNotes: JSON.stringify(snapshot.validationNotes ?? []),
      updatedAt: snapshot.updatedAt ?? new Date().toISOString(),
    })
    return
  }

  db.prepare(`
    INSERT INTO organization_snapshots (did, record_uri, rkey, payload, updated_at)
    VALUES (@did, @recordUri, @rkey, @payload, @updatedAt)
    ON CONFLICT(did) DO UPDATE SET
      record_uri = excluded.record_uri,
      rkey = excluded.rkey,
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `).run({
    did: snapshot.did,
    recordUri: snapshot.recordUri,
    rkey: snapshot.rkey,
    payload: JSON.stringify(snapshot.payload),
    updatedAt: snapshot.updatedAt ?? new Date().toISOString(),
  })
}

function getSnapshot<T>(
  table: 'profile_snapshots' | 'organization_snapshots',
  did: string,
): SnapshotRecord<T> | null {
  const db = getDb()
  const selectColumns = table === 'profile_snapshots'
    ? 'did, record_uri, rkey, payload, updated_at, validation_notes'
    : 'did, record_uri, rkey, payload, updated_at'
  const row = db.prepare(
    `SELECT ${selectColumns} FROM ${table} WHERE did = ?`
  ).get(did) as SnapshotRow | undefined

  return row ? snapshotRowToEntry<T>(row) : null
}

function listSnapshots<T>(
  table: 'profile_snapshots' | 'organization_snapshots',
  limit = 50,
  offset = 0,
): Array<SnapshotRecord<T>> {
  const db = getDb()
  const safeLimit = Math.max(1, Math.min(limit || 50, 100))
  const safeOffset = Math.max(0, offset || 0)
  const selectColumns = table === 'profile_snapshots'
    ? 'did, record_uri, rkey, payload, updated_at, validation_notes'
    : 'did, record_uri, rkey, payload, updated_at'
  const rows = db.prepare(`
    SELECT ${selectColumns}
    FROM ${table}
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).all(safeLimit, safeOffset) as SnapshotRow[]

  return rows
    .map(row => snapshotRowToEntry<T>(row))
    .filter((snapshot): snapshot is SnapshotRecord<T> => snapshot !== null)
}

function deleteSnapshot(table: 'profile_snapshots' | 'organization_snapshots', did: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM ${table} WHERE did = ?`).run(did)
}

export function upsertProfileSnapshot(snapshot: SnapshotInput<ProfileSnapshot['payload']>): void {
  upsertSnapshot('profile_snapshots', snapshot)
}

export function getProfileSnapshot(did: string): (ProfileSnapshot & { validationNotes: string[] }) | null {
  const snapshot = getSnapshot<ProfileSnapshot['payload']>('profile_snapshots', did)
  if (!snapshot) return null

  return {
    ...snapshot,
    validationNotes: snapshot.validationNotes ?? [],
  }
}

export function listProfileSnapshots(limit = 50, offset = 0): Array<ProfileSnapshot & { validationNotes: string[] }> {
  return listSnapshots<ProfileSnapshot['payload']>('profile_snapshots', limit, offset).map(snapshot => ({
    ...snapshot,
    validationNotes: snapshot.validationNotes ?? [],
  }))
}

export function deleteProfileSnapshot(did: string): void {
  deleteSnapshot('profile_snapshots', did)
}

export function upsertOrganizationSnapshot(snapshot: SnapshotInput<OrganizationSnapshot['payload']>): void {
  upsertSnapshot('organization_snapshots', snapshot)
}

export function getOrganizationSnapshot(did: string): OrganizationSnapshot | null {
  return getSnapshot<OrganizationSnapshot['payload']>('organization_snapshots', did)
}

export function listOrganizationSnapshots(limit = 50, offset = 0): OrganizationSnapshot[] {
  return listSnapshots<OrganizationSnapshot['payload']>('organization_snapshots', limit, offset)
}

export function getAllOrganizationSnapshots(): OrganizationSnapshot[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT did, record_uri, rkey, payload, updated_at
    FROM organization_snapshots
    ORDER BY updated_at DESC
  `).all() as SnapshotRow[]

  return rows
    .map(row => snapshotRowToEntry<OrganizationSnapshot['payload']>(row))
    .filter((snapshot): snapshot is SnapshotRecord<OrganizationSnapshot['payload']> => snapshot !== null)
}

export function deleteOrganizationSnapshot(did: string): void {
  deleteSnapshot('organization_snapshots', did)
}

export function deleteOrganizationRecordState(did: string, rkey: string): void {
  const db = getDb()
  db.prepare('DELETE FROM organization_snapshots WHERE did = ?').run(did)
  db.prepare('DELETE FROM activities WHERE did = ? AND rkey = ?').run(did, rkey)
}

/**
 * Completes a queued organization delete without deleting a newer replacement snapshot.
 * Returns false when the pending delete was already cleared or superseded by a newer upsert.
 */
export function completePendingOrganizationDelete(did: string, rkey: string, recordUri: string): boolean {
  const db = getDb()

  return db.transaction(() => {
    const pending = db.prepare(`
      SELECT did, record_uri, rkey
      FROM pending_organization_deletes
      WHERE did = ?
    `).get(did) as Pick<PendingOrganizationDeleteRow, 'did' | 'record_uri' | 'rkey'> | undefined

    if (!pending || pending.rkey !== rkey || pending.record_uri !== recordUri) {
      return false
    }

    db.prepare(`
      DELETE FROM organization_snapshots
      WHERE did = @did AND rkey = @rkey AND record_uri = @recordUri
    `).run({ did, rkey, recordUri })
    db.prepare('DELETE FROM activities WHERE did = ? AND rkey = ?').run(did, rkey)
    db.prepare(`
      DELETE FROM pending_organization_deletes
      WHERE did = @did AND rkey = @rkey AND record_uri = @recordUri
    `).run({ did, rkey, recordUri })

    return true
  })()
}

export function upsertPendingOrganizationDelete(did: string, rkey: string, recordUri: string): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO pending_organization_deletes
      (did, record_uri, rkey, attempts, last_attempt_at, next_attempt_at, last_error, created_at, updated_at)
    VALUES
      (@did, @recordUri, @rkey, 0, NULL, NULL, NULL, datetime('now'), datetime('now'))
    ON CONFLICT(did) DO UPDATE SET
      record_uri = excluded.record_uri,
      rkey = excluded.rkey,
      next_attempt_at = NULL,
      updated_at = excluded.updated_at
  `).run({ did, rkey, recordUri })
}

export function recordPendingOrganizationDeleteAttempt(did: string, errorMessage?: string | null, retryDelayMs = 60_000): void {
  const db = getDb()
  const nextAttemptAt = new Date(Date.now() + retryDelayMs).toISOString()
  db.prepare(`
    UPDATE pending_organization_deletes
    SET attempts = attempts + 1,
        last_attempt_at = datetime('now'),
        next_attempt_at = @nextAttemptAt,
        last_error = @lastError,
        updated_at = datetime('now')
    WHERE did = @did
  `).run({ did, nextAttemptAt, lastError: errorMessage ?? null })
}

export function getPendingOrganizationDeletes(now = new Date().toISOString()): Array<PendingOrganizationDeleteRow> {
  const db = getDb()
  return db.prepare(`
    SELECT did, record_uri, rkey, attempts, last_attempt_at, next_attempt_at, last_error, created_at, updated_at
    FROM pending_organization_deletes
    WHERE next_attempt_at IS NULL OR next_attempt_at <= @now
    ORDER BY updated_at ASC
  `).all({ now }) as Array<PendingOrganizationDeleteRow>
}

export function hasPendingOrganizationDelete(did: string): boolean {
  const db = getDb()
  const row = db.prepare('SELECT 1 FROM pending_organization_deletes WHERE did = ? LIMIT 1').get(did)
  return Boolean(row)
}

/**
 * Checks whether a queued organization delete still targets the same record.
 * Use this after async label cleanup to avoid applying actor-level cleanup for
 * a delete that was superseded by a newer organization upsert.
 */
export function hasMatchingPendingOrganizationDelete(did: string, rkey: string, recordUri: string): boolean {
  const db = getDb()
  const row = db.prepare(`
    SELECT 1
    FROM pending_organization_deletes
    WHERE did = @did AND rkey = @rkey AND record_uri = @recordUri
    LIMIT 1
  `).get({ did, rkey, recordUri })
  return Boolean(row)
}

export function deletePendingOrganizationDelete(did: string): void {
  const db = getDb()
  db.prepare('DELETE FROM pending_organization_deletes WHERE did = ?').run(did)
}

/**
 * Coalesces actor-level scoring work into one durable SQLite job per DID.
 * Use this from the Tap handler after persisting snapshots so slow label work can
 * run after Tap has acknowledged the event.
 */
export function enqueueRecomputeJob(
  kind: RecomputeJobKind,
  key: string,
  options: { delayMs?: number; payload?: Record<string, unknown> | null } = {},
): void {
  const db = getDb()
  const nowMs = Date.now()
  const runAfter = new Date(nowMs + (options.delayMs ?? 2000)).toISOString()
  const payload = options.payload === undefined || options.payload === null
    ? null
    : JSON.stringify(options.payload)

  db.prepare(`
    INSERT INTO recompute_jobs
      (kind, key, status, attempts, run_after, payload, last_error, created_at, updated_at)
    VALUES
      (@kind, @key, 'pending', 0, @runAfter, @payload, NULL, datetime('now'), datetime('now'))
    ON CONFLICT(kind, key) DO UPDATE SET
      status = 'pending',
      attempts = CASE WHEN recompute_jobs.status IN ('done', 'failed') THEN 0 ELSE recompute_jobs.attempts END,
      run_after = excluded.run_after,
      payload = COALESCE(excluded.payload, recompute_jobs.payload),
      last_error = NULL,
      updated_at = datetime('now')
  `).run({ kind, key, runAfter, payload })
}

/**
 * Atomically claims the oldest due recompute job for a single worker process.
 * Returns null when no debounced job is ready to run yet.
 */
export function claimDueRecomputeJob(now = new Date().toISOString()): RecomputeJob | null {
  const db = getDb()
  const row = db.prepare(`
    UPDATE recompute_jobs
    SET status = 'running',
        attempts = attempts + 1,
        updated_at = datetime('now')
    WHERE id = (
      SELECT id
      FROM recompute_jobs
      WHERE status = 'pending' AND run_after <= @now
      ORDER BY run_after ASC, updated_at ASC
      LIMIT 1
    )
    RETURNING id, kind, key, status, attempts, run_after, payload, last_error, created_at, updated_at
  `).get({ now }) as RecomputeJobRow | undefined

  return row ? recomputeJobRowToEntry(row) : null
}

/**
 * Marks a claimed recompute job as done while keeping the row available for metrics.
 * The status guard preserves a newer pending enqueue that arrived while this job was running.
 */
export function completeRecomputeJob(id: number): number {
  const db = getDb()
  const result = db.prepare(`
    UPDATE recompute_jobs
    SET status = 'done',
        attempts = 0,
        last_error = NULL,
        updated_at = datetime('now')
    WHERE id = ? AND status = 'running'
  `).run(id)

  return result.changes
}

/**
 * Records a recompute failure and schedules another attempt with bounded backoff.
 * The unique job row is reused, so newer Tap events can still coalesce over it.
 */
export function recoverStaleRunningRecomputeJobs(staleAfterMs: number): number {
  const db = getDb()
  const staleSeconds = Math.max(1, Math.ceil(staleAfterMs / 1000))
  const result = db.prepare(`
    UPDATE recompute_jobs
    SET status = 'pending',
        run_after = @now,
        last_error = 'Recovered stale running recompute job after process interruption',
        updated_at = datetime('now')
    WHERE status = 'running' AND updated_at <= datetime('now', @staleModifier)
  `).run({ now: new Date().toISOString(), staleModifier: `-${staleSeconds} seconds` })

  return result.changes
}

export function failRecomputeJob(
  id: number,
  errorMessage: string,
  retryDelayMs: number,
  status: Extract<RecomputeJobStatus, 'pending' | 'failed'> = 'pending',
): void {
  const db = getDb()
  const runAfter = new Date(Date.now() + retryDelayMs).toISOString()
  db.prepare(`
    UPDATE recompute_jobs
    SET status = @status,
        run_after = @runAfter,
        last_error = @errorMessage,
        updated_at = datetime('now')
    WHERE id = @id AND status = 'running'
  `).run({ id, status, runAfter, errorMessage })
}

/** Returns queue counts grouped by status for lightweight health logging and metrics. */
export function getRecomputeJobCounts(): Record<RecomputeJobStatus, number> {
  const db = getDb()
  const counts: Record<RecomputeJobStatus, number> = {
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
  }
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM recompute_jobs
    GROUP BY status
  `).all() as Array<{ status: RecomputeJobStatus; count: number }>

  for (const row of rows) {
    counts[row.status] = row.count
  }
  return counts
}

/** Reads cached actor PDS state, if this DID has been resolved before. */
export function getActorPdsCache(did: string): ActorPdsCache | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT did, status, pds_url, pds_host, checked_at, expires_at, last_error, created_at, updated_at
    FROM actor_pds_cache
    WHERE did = ?
  `).get(did) as ActorPdsCacheRow | undefined

  return row ? actorPdsCacheRowToEntry(row) : null
}

/** Returns true when a cached PDS row should be refreshed before URL enrichment. */
export function isActorPdsCacheStale(cache: ActorPdsCache, now = new Date().toISOString()): boolean {
  return cache.expiresAt <= now
}

/** Creates or refreshes a pending actor PDS cache row without erasing old host data. */
export function recordActorPdsPending(did: string, retryAfterMs: number): void {
  const db = getDb()
  const expiresAt = new Date(Date.now() + retryAfterMs).toISOString()
  db.prepare(`
    INSERT INTO actor_pds_cache
      (did, status, pds_url, pds_host, checked_at, expires_at, last_error, created_at, updated_at)
    VALUES
      (@did, 'pending', NULL, NULL, NULL, @expiresAt, NULL, datetime('now'), datetime('now'))
    ON CONFLICT(did) DO UPDATE SET
      status = 'pending',
      expires_at = excluded.expires_at,
      last_error = NULL,
      updated_at = datetime('now')
  `).run({ did, expiresAt })
}

/** Stores a successful actor DID → PDS resolution result. */
export function recordActorPdsOk(did: string, pdsUrl: string, pdsHost: string, ttlMs: number): void {
  const db = getDb()
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  db.prepare(`
    INSERT INTO actor_pds_cache
      (did, status, pds_url, pds_host, checked_at, expires_at, last_error, created_at, updated_at)
    VALUES
      (@did, 'ok', @pdsUrl, @pdsHost, @now, @expiresAt, NULL, datetime('now'), datetime('now'))
    ON CONFLICT(did) DO UPDATE SET
      status = 'ok',
      pds_url = excluded.pds_url,
      pds_host = excluded.pds_host,
      checked_at = excluded.checked_at,
      expires_at = excluded.expires_at,
      last_error = NULL,
      updated_at = datetime('now')
  `).run({ did, pdsUrl, pdsHost, now, expiresAt })
}

/** Stores a failed actor PDS resolution attempt while preserving any stale host. */
export function recordActorPdsFailure(did: string, errorMessage: string, retryAfterMs: number): void {
  const db = getDb()
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + retryAfterMs).toISOString()
  db.prepare(`
    INSERT INTO actor_pds_cache
      (did, status, pds_url, pds_host, checked_at, expires_at, last_error, created_at, updated_at)
    VALUES
      (@did, 'failed', NULL, NULL, @now, @expiresAt, @errorMessage, datetime('now'), datetime('now'))
    ON CONFLICT(did) DO UPDATE SET
      status = 'failed',
      checked_at = excluded.checked_at,
      expires_at = excluded.expires_at,
      last_error = excluded.last_error,
      updated_at = datetime('now')
  `).run({ did, now, expiresAt, errorMessage })
}

/**
 * Ensures a normalized public URL has a cache row for async enrichment.
 * Fresh ok/failed rows are left untouched so repeated snapshots do not reset TTLs.
 */
export function upsertPendingUrlCheck(normalizedUrl: string, now = new Date().toISOString()): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO url_checks
      (normalized_url, status, resolvable, status_code, error, attempts, last_attempt_at, checked_at, expires_at, created_at, updated_at)
    VALUES
      (@normalizedUrl, 'pending', NULL, NULL, NULL, 0, NULL, NULL, @now, datetime('now'), datetime('now'))
    ON CONFLICT(normalized_url) DO UPDATE SET
      status = CASE WHEN url_checks.expires_at <= @now AND url_checks.status != 'pending' THEN 'pending' ELSE url_checks.status END,
      resolvable = CASE WHEN url_checks.expires_at <= @now AND url_checks.status != 'pending' THEN NULL ELSE url_checks.resolvable END,
      status_code = CASE WHEN url_checks.expires_at <= @now AND url_checks.status != 'pending' THEN NULL ELSE url_checks.status_code END,
      error = CASE WHEN url_checks.expires_at <= @now AND url_checks.status != 'pending' THEN NULL ELSE url_checks.error END,
      attempts = CASE WHEN url_checks.expires_at <= @now AND url_checks.status != 'pending' THEN 0 ELSE url_checks.attempts END,
      expires_at = CASE WHEN url_checks.expires_at <= @now AND url_checks.status != 'pending' THEN @now ELSE url_checks.expires_at END,
      updated_at = CASE WHEN url_checks.expires_at <= @now AND url_checks.status != 'pending' THEN datetime('now') ELSE url_checks.updated_at END
  `).run({ normalizedUrl, now })
}

/** Returns the next due URL cache row, or null when no URL check is ready. */
export function getDueUrlCheck(now = new Date().toISOString()): UrlCheck | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT normalized_url, status, resolvable, status_code, error, attempts, last_attempt_at, checked_at, expires_at, created_at, updated_at
    FROM url_checks
    WHERE expires_at <= @now
    ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, expires_at ASC, updated_at ASC
    LIMIT 1
  `).get({ now }) as UrlCheckRow | undefined

  return row ? urlCheckRowToEntry(row) : null
}

/** Stores a successful URL check and keeps the ok result fresh for the supplied TTL. */
export function recordUrlCheckOk(normalizedUrl: string, statusCode: number | null, ttlMs: number): void {
  const db = getDb()
  const now = new Date()
  const checkedAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString()

  db.prepare(`
    UPDATE url_checks
    SET status = 'ok',
        resolvable = 1,
        status_code = @statusCode,
        error = NULL,
        attempts = 0,
        last_attempt_at = @checkedAt,
        checked_at = @checkedAt,
        expires_at = @expiresAt,
        updated_at = datetime('now')
    WHERE normalized_url = @normalizedUrl
  `).run({ normalizedUrl, statusCode, checkedAt, expiresAt })
}

/**
 * Stores a failed URL check. Use status='pending' for temporary retryable
 * failures and status='failed' only when scoring should remove URL resolve points.
 */
export function recordUrlCheckFailure(options: {
  normalizedUrl: string
  status: Extract<UrlCheckStatus, 'pending' | 'failed'>
  resolvable: boolean | null
  statusCode: number | null
  error: string
  attempts: number
  retryAfterMs: number
}): void {
  const db = getDb()
  const now = new Date()
  const checkedAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + options.retryAfterMs).toISOString()

  db.prepare(`
    UPDATE url_checks
    SET status = @status,
        resolvable = @resolvable,
        status_code = @statusCode,
        error = @error,
        attempts = @attempts,
        last_attempt_at = @checkedAt,
        checked_at = @checkedAt,
        expires_at = @expiresAt,
        updated_at = datetime('now')
    WHERE normalized_url = @normalizedUrl
  `).run({
    normalizedUrl: options.normalizedUrl,
    status: options.status,
    resolvable: options.resolvable === null ? null : options.resolvable ? 1 : 0,
    statusCode: options.statusCode,
    error: options.error.slice(0, 1000),
    attempts: options.attempts,
    checkedAt,
    expiresAt,
  })
}

/** Returns the active scoring state for normalized URLs from the detachable URL cache. */
export function getUrlResolutionMap(normalizedUrls: string[], now = new Date().toISOString()): UrlResolutionMap {
  const db = getDb()
  const uniqueUrls = [...new Set(normalizedUrls)].filter(url => url.length > 0)
  if (uniqueUrls.length === 0) return {}

  const placeholders = uniqueUrls.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT normalized_url, status, expires_at
    FROM url_checks
    WHERE normalized_url IN (${placeholders}) AND expires_at > ?
  `).all(...uniqueUrls, now) as Array<{ normalized_url: string; status: UrlCheckStatus; expires_at: string }>

  const states: UrlResolutionMap = {}
  for (const row of rows) {
    const state = urlCheckStatusToResolutionState(row.status)
    if (state !== 'unknown') {
      states[row.normalized_url] = state
    }
  }
  return states
}

/** Returns URL cache counts grouped by status for metrics and smoke tests. */
export function getUrlCheckCounts(): Record<UrlCheckStatus, number> {
  const db = getDb()
  const counts: Record<UrlCheckStatus, number> = {
    pending: 0,
    ok: 0,
    failed: 0,
  }
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM url_checks
    GROUP BY status
  `).all() as Array<{ status: UrlCheckStatus; count: number }>

  for (const row of rows) {
    counts[row.status] = row.count
  }
  return counts
}

function urlCheckStatusToResolutionState(status: UrlCheckStatus): UrlResolutionState {
  if (status === 'ok') return 'ok'
  if (status === 'failed') return 'failed'
  return 'unknown'
}

// Upsert on did+rkey. Preserves existing hf_label/hf_score when the new values are null.
export function logActivity(entry: ActivityLogInput, hf?: HfClassificationData): void {
  const db = getDb()
  const displayName = entry.displayName ?? entry.title
  if (!displayName) {
    throw new Error('logActivity requires a displayName')
  }

  const stmt = db.prepare(`
    INSERT INTO activities
      (did, rkey, uri, title, score, tier, breakdown, test_signals, validation_notes, labeled_at, hf_label, hf_score)
    VALUES
      (@did, @rkey, @uri, @title, @score, @tier, @breakdown, @testSignals, @validationNotes, @labeledAt, @hfLabel, @hfScore)
    ON CONFLICT(did, rkey) DO UPDATE SET
      uri = excluded.uri,
      title = excluded.title,
      score = excluded.score,
      tier = excluded.tier,
      breakdown = excluded.breakdown,
      test_signals = excluded.test_signals,
      validation_notes = excluded.validation_notes,
      labeled_at = excluded.labeled_at,
      hf_label = COALESCE(excluded.hf_label, activities.hf_label),
      hf_score = COALESCE(excluded.hf_score, activities.hf_score)
  `)
  stmt.run({
    did: entry.did,
    rkey: entry.rkey,
    uri: entry.uri,
    title: displayName,
    score: entry.score,
    tier: entry.tier,
    breakdown: entry.breakdown,
    testSignals: entry.testSignals,
    validationNotes: JSON.stringify(entry.validationNotes ?? []),
    labeledAt: entry.labeledAt,
    hfLabel: hf?.hfLabel ?? null,
    hfScore: hf?.hfScore ?? null,
  })
}

// Update an existing activity row's score, tier, breakdown, testSignals, and validation notes.
export function updateActivity(did: string, rkey: string, updates: { score: number; tier: LabelTier; breakdown: string; testSignals: string; validationNotes?: string[] }): void {
  const db = getDb()
  db.prepare(`
    UPDATE activities
    SET score = @score, tier = @tier, breakdown = @breakdown, test_signals = @testSignals, validation_notes = COALESCE(@validationNotes, validation_notes)
    WHERE did = @did AND rkey = @rkey
  `).run({
    score: updates.score,
    tier: updates.tier,
    breakdown: updates.breakdown,
    testSignals: updates.testSignals,
    validationNotes: updates.validationNotes ? JSON.stringify(updates.validationNotes) : null,
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
    SELECT ${ACTIVITY_SELECT_COLUMNS}
    FROM activities
    ORDER BY labeled_at DESC
    LIMIT ? OFFSET ?
  `).all(safeLimit, safeOffset) as Array<Record<string, unknown>>

  return rows.map(rowToEntry)
}

// Get activities filtered by active tier. Sorted by labeled_at DESC.
// Fix 5: Clamp limit/offset to safe values to prevent negative or NaN inputs.
export function getActivitiesByTier(tier: RuntimeLabelTier, limit = 20, offset = 0): ActivityLogEntry[] {
  const db = getDb()
  const safeLimit = Math.max(1, Math.min(limit || 20, 100))
  const safeOffset = Math.max(0, offset || 0)
  const rows = db.prepare(`
    SELECT ${ACTIVITY_SELECT_COLUMNS}
    FROM activities
    WHERE tier = ?
    ORDER BY labeled_at DESC
    LIMIT ? OFFSET ?
  `).all(tier, safeLimit, safeOffset) as Array<Record<string, unknown>>

  return rows.map(rowToEntry)
}

// Get total count (optionally filtered by active tier)
export function getTotalCount(tier?: RuntimeLabelTier): number {
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
      SUM(CASE WHEN tier = 'high-quality' THEN 1 ELSE 0 END) as high_quality,
      SUM(CASE WHEN tier = 'standard' THEN 1 ELSE 0 END) as standard,
      SUM(CASE WHEN tier = 'likely-test' THEN 1 ELSE 0 END) as likely_test,
      SUM(CASE WHEN labeled_at > strftime('%Y-%m-%dT%H:%M:%S', 'now', '-1 day') THEN 1 ELSE 0 END) as last_24h,
      SUM(CASE WHEN labeled_at > strftime('%Y-%m-%dT%H:%M:%S', 'now', '-7 days') THEN 1 ELSE 0 END) as last_7d,
      SUM(CASE WHEN hf_label IS NOT NULL THEN 1 ELSE 0 END) as hf_classified,
      SUM(CASE WHEN hf_label IS NULL THEN 1 ELSE 0 END) as hf_pending
    FROM activities
  `).get() as Record<string, number>

  return {
    total: row['total'] ?? 0,
    byTier: {
      'high-quality': row['high_quality'] ?? 0,
      'standard': row['standard'] ?? 0,
      'likely-test': row['likely_test'] ?? 0,
    },
    last24h: row['last_24h'] ?? 0,
    last7d: row['last_7d'] ?? 0,
    hfCoverage: {
      classified: row['hf_classified'] ?? 0,
      pending: row['hf_pending'] ?? 0,
      total: (row['hf_classified'] ?? 0) + (row['hf_pending'] ?? 0),
    },
  }
}

// Legacy startup cleanup for rows that predate the active 3-tier set.
export function getPendingActivities(): ActivityLogEntry[] {
  const db = getDb()
  const rows = db.prepare(
    `SELECT ${ACTIVITY_SELECT_COLUMNS} FROM activities WHERE tier NOT IN (?, ?, ?)`
  ).all('likely-test', 'standard', 'high-quality') as Array<Record<string, unknown>>
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

// Clear HF classification so the row can be re-evaluated against a newer merged text snapshot.
export function clearActivityHfFields(did: string, rkey: string): void {
  const db = getDb()
  db.prepare('UPDATE activities SET hf_label = NULL, hf_score = NULL WHERE did = ? AND rkey = ?')
    .run(did, rkey)
}

// Get activities that have been AI-evaluated (hf_label IS NOT NULL). Sorted by labeled_at DESC.
export function getAiEvaluatedActivities(limit = 20, offset = 0): ActivityLogEntry[] {
  const db = getDb()
  const safeLimit = Math.max(1, Math.min(limit || 20, 100))
  const safeOffset = Math.max(0, offset || 0)
  const rows = db.prepare(`
    SELECT ${ACTIVITY_SELECT_COLUMNS}
    FROM activities
    WHERE hf_label IS NOT NULL
    ORDER BY labeled_at DESC
    LIMIT ? OFFSET ?
  `).all(safeLimit, safeOffset) as Array<Record<string, unknown>>
  return rows.map(rowToEntry)
}

// Get count of activities that have been AI-evaluated (hf_label IS NOT NULL).
export function getAiEvaluatedCount(): number {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as count FROM activities WHERE hf_label IS NOT NULL').get() as { count: number }
  return row.count
}

// Get all activities that have not yet been classified by HF (hf_label IS NULL).
export function getUnclassifiedActivities(): Array<{ did: string; rkey: string; title: string; displayName: string }> {
  const db = getDb()
  return db.prepare(
    'SELECT did, rkey, title, title AS displayName FROM activities WHERE hf_label IS NULL ORDER BY id ASC'
  ).all() as Array<{ did: string; rkey: string; title: string; displayName: string }>
}

// Get all activities that have HF classification but were NOT flagged (tier is not 'likely-test')
// and whose HF label is not the positive actor-profile label.
// These need re-evaluation against potentially updated thresholds.
export function getHfClassifiedNonFlagged(): Array<{ did: string; rkey: string; hfLabel: string; hfScore: number }> {
  const db = getDb()
  return db.prepare(
    'SELECT did, rkey, hf_label as hfLabel, hf_score as hfScore FROM activities WHERE hf_label IS NOT NULL AND hf_label != ? AND tier != \'likely-test\' ORDER BY id ASC'
  ).all(HF_POSITIVE_LABEL) as Array<{ did: string; rkey: string; hfLabel: string; hfScore: number }>
}

// Get all activities with their current tier. Used for label sync on startup.
export function getAllActivitiesForSync(): Array<{ did: string; rkey: string; uri: string; tier: string }> {
  const db = getDb()
  return db.prepare(
    'SELECT did, rkey, uri, tier FROM activities ORDER BY id ASC'
  ).all() as Array<{ did: string; rkey: string; uri: string; tier: string }>
}

// Search activities by displayName, DID, or URI. Sorted by labeled_at DESC.
export function searchActivities(query: string, limit = 20, offset = 0): ActivityLogEntry[] {
  const db = getDb()
  const safeLimit = Math.max(1, Math.min(limit || 20, 100))
  const safeOffset = Math.max(0, offset || 0)
  const pattern = `%${query}%`
  const rows = db.prepare(`
    SELECT ${ACTIVITY_SELECT_COLUMNS}
    FROM activities
    WHERE title LIKE @pattern OR did LIKE @pattern OR uri LIKE @pattern
    ORDER BY labeled_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ pattern, limit: safeLimit, offset: safeOffset }) as Array<Record<string, unknown>>
  return rows.map(rowToEntry)
}

// Get count of activities matching a search query (displayName, DID, or URI).
export function searchActivitiesCount(query: string): number {
  const db = getDb()
  const pattern = `%${query}%`
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM activities WHERE title LIKE ? OR did LIKE ? OR uri LIKE ?'
  ).get(pattern, pattern, pattern) as { count: number }
  return row.count
}

// Fetch a single activity by did + rkey. Returns null if not found.
export function getActivityByDidRkey(did: string, rkey: string): ActivityLogEntry | null {
  const db = getDb()
  const row = db.prepare(
    `SELECT ${ACTIVITY_SELECT_COLUMNS} FROM activities WHERE did = ? AND rkey = ?`
  ).get(did, rkey) as Record<string, unknown> | undefined
  return row ? rowToEntry(row) : null
}

function actorPdsCacheRowToEntry(row: ActorPdsCacheRow): ActorPdsCache {
  return {
    did: row.did,
    status: row.status as ActorPdsCacheStatus,
    pdsUrl: row.pds_url,
    pdsHost: row.pds_host,
    checkedAt: row.checked_at,
    expiresAt: row.expires_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function recomputeJobRowToEntry(row: RecomputeJobRow): RecomputeJob {
  return {
    id: row.id,
    kind: row.kind as RecomputeJobKind,
    key: row.key,
    status: row.status as RecomputeJobStatus,
    attempts: row.attempts,
    runAfter: row.run_after,
    payload: row.payload,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function urlCheckRowToEntry(row: UrlCheckRow): UrlCheck {
  return {
    normalizedUrl: row.normalized_url,
    status: row.status as UrlCheckStatus,
    resolvable: row.resolvable === null ? null : row.resolvable === 1,
    statusCode: row.status_code,
    error: row.error,
    attempts: row.attempts,
    lastAttemptAt: row.last_attempt_at,
    checkedAt: row.checked_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToEntry(row: Record<string, unknown>): ActivityLogEntry {
  return {
    id: row['id'] as number,
    did: row['did'] as string,
    rkey: row['rkey'] as string,
    uri: row['uri'] as string,
    displayName: row['displayName'] as string,
    score: row['score'] as number,
    tier: row['tier'] as LabelTier,
    breakdown: row['breakdown'] as string,
    testSignals: row['test_signals'] as string,
    validationNotes: parseValidationNotes(row['validation_notes'] as string | null | undefined) ?? [],
    labeledAt: row['labeled_at'] as string,
    hfLabel: (row['hf_label'] as string | null) ?? null,
    hfScore: (row['hf_score'] as number | null) ?? null,
  }
}

function snapshotRowToEntry<T>(row: SnapshotRow): SnapshotRecord<T> | null {
  const validationNotes: string[] = []
  const payload = parseSnapshotPayload<T>(row.payload, validationNotes)
  const rowNotes = parseValidationNotes(row.validation_notes)

  if (rowNotes) validationNotes.push(...rowNotes)

  if (payload === null) return null

  return {
    did: row.did,
    recordUri: row.record_uri,
    rkey: row.rkey,
    payload,
    updatedAt: row.updated_at,
    validationNotes: validationNotes.length > 0 ? validationNotes : undefined,
  } as SnapshotRecord<T>
}

function parseSnapshotPayload<T>(value: string, validationNotes: string[]): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    validationNotes.push('Snapshot payload JSON failed to parse')
    return null
  }
}

function parseValidationNotes(value: string | null | undefined): string[] | undefined {
  if (!value) return undefined

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined
  } catch {
    return undefined
  }
}
