import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { ACTIVITY_DB_PATH } from './config'
import type {
  AssessmentFeedEntry,
  JevAssessmentRecord,
  JevAssessmentStatus,
  LabelStats,
  OrganizationSnapshot,
  ProfileSnapshot,
  PublishedLabelStatus,
  ReassessmentRun,
  RuntimeLabelTier,
} from './types'
import type { UrlResolutionMap, UrlResolutionState } from './actor-evidence'

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

interface JevAssessmentRow {
  did: string
  rkey: string
  uri: string
  display_name: string
  input_identity: string
  result_input_identity: string | null
  model: string | null
  question_version: string | null
  policy_version: string | null
  probabilities: string | null
  status: string
  published_tier: string | null
  label_status: string
  last_error: string | null
  updated_at: string
  assessed_at: string | null
}

interface ReassessmentRunRow {
  id: string
  status: string
  started_by_did: string
  started_at: string
  finished_at: string | null
  total: number
  completed: number
  failed: number
  skipped: number
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

/** Durable URL cache status. Pending means Jev receives the URL as unresolved evidence. */
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

function createJevAssessmentTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jev_assessments (
      did TEXT PRIMARY KEY,
      rkey TEXT NOT NULL,
      uri TEXT NOT NULL,
      display_name TEXT NOT NULL,
      input_identity TEXT NOT NULL,
      result_input_identity TEXT,
      model TEXT,
      question_version TEXT,
      policy_version TEXT,
      probabilities TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued', 'assessing', 'assessed', 'uncertain', 'awaiting-configuration', 'awaiting-pds-resolution', 'failed', 'legacy-stale')),
      published_tier TEXT CHECK(published_tier IS NULL OR published_tier IN ('likely-test', 'standard', 'high-quality')),
      label_status TEXT NOT NULL CHECK(label_status IN ('none', 'current', 'stale')),
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      assessed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jev_assessments_status ON jev_assessments(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_jev_assessments_tier ON jev_assessments(published_tier);

    CREATE TABLE IF NOT EXISTS reassessment_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed')),
      started_by_did TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_reassessment_one_active_run
      ON reassessment_runs(status) WHERE status = 'running';

    CREATE TABLE IF NOT EXISTS reassessment_run_items (
      run_id TEXT NOT NULL REFERENCES reassessment_runs(id) ON DELETE CASCADE,
      did TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(run_id, did)
    );

    CREATE INDEX IF NOT EXISTS idx_reassessment_run_items_status
      ON reassessment_run_items(run_id, status);
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

function createAdminSessionsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      csrf_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_did ON admin_sessions(did);
  `)
}

function createAdminOAuthStatesTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_oauth_states (
      state_hash TEXT PRIMARY KEY,
      browser_hash TEXT NOT NULL,
      encrypted_state TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_admin_oauth_states_expires_at ON admin_oauth_states(expires_at);
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

function migrateLegacyJevAssessments(db: Database.Database): void {
  db.exec(`
    INSERT OR IGNORE INTO jev_assessments
      (did, rkey, uri, display_name, input_identity, result_input_identity, model, question_version, policy_version, probabilities,
       status, published_tier, label_status, last_error, updated_at, assessed_at)
    SELECT
      snapshots.did,
      snapshots.rkey,
      snapshots.record_uri,
      COALESCE(activities.title, snapshots.did),
      'legacy-unassessed',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      'awaiting-configuration',
      activities.tier,
      CASE WHEN activities.tier IS NULL THEN 'none' ELSE 'stale' END,
      CASE WHEN activities.tier IS NULL THEN NULL ELSE 'Previous score-based label is retained as stale until a Jev assessment completes' END,
      COALESCE(activities.labeled_at, snapshots.updated_at),
      NULL
    FROM organization_snapshots AS snapshots
    LEFT JOIN activities ON activities.did = snapshots.did AND activities.rkey = snapshots.rkey
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
  createJevAssessmentTables(_db)
  createActorPdsCacheTable(_db)
  createUrlChecksTable(_db)
  createAdminSessionsTable(_db)
  createAdminOAuthStatesTable(_db)

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
  migrateLegacyJevAssessments(_db)

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
    db.prepare('DELETE FROM jev_assessments WHERE did = ?').run(did)
    db.prepare(`
      UPDATE reassessment_run_items
      SET status = 'skipped', updated_at = datetime('now')
      WHERE did = ? AND status IN ('pending', 'running')
    `).run(did)
    completeReassessmentRunsWithNoPendingItems(db)
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
 * Coalesces actor-level assessment work into one durable SQLite job per DID.
 * Use this from the Tap handler after persisting snapshots so slow label work can
 * run after Tap has acknowledged the event.
 */
export function enqueueRecomputeJob(
  kind: RecomputeJobKind,
  key: string,
  options: { delayMs?: number; payload?: Record<string, unknown> | null } = {},
): void {
  const db = getDb()
  enqueueRecomputeJobInTransaction(db, kind, key, options)
}

function enqueueRecomputeJobInTransaction(
  db: Database.Database,
  kind: RecomputeJobKind,
  key: string,
  options: { delayMs?: number; payload?: Record<string, unknown> | null },
): void {
  const nowMs = Date.now()
  const runAfter = new Date(nowMs + (options.delayMs ?? 2000)).toISOString()
  const existing = db.prepare('SELECT payload FROM recompute_jobs WHERE kind = ? AND key = ?').get(kind, key) as { payload: string | null } | undefined
  const payload = mergeJobPayload(existing?.payload ?? null, options.payload ?? null)

  db.prepare(`
    INSERT INTO recompute_jobs
      (kind, key, status, attempts, run_after, payload, last_error, created_at, updated_at)
    VALUES
      (@kind, @key, 'pending', 0, @runAfter, @payload, NULL, datetime('now'), datetime('now'))
    ON CONFLICT(kind, key) DO UPDATE SET
      status = 'pending',
      attempts = CASE WHEN recompute_jobs.status IN ('done', 'failed') THEN 0 ELSE recompute_jobs.attempts END,
      run_after = excluded.run_after,
      payload = excluded.payload,
      last_error = NULL,
      updated_at = datetime('now')
  `).run({ kind, key, runAfter, payload })
}

function mergeJobPayload(existingJson: string | null, incoming: Record<string, unknown> | null): string | null {
  const existing = parseObjectJson(existingJson)
  const merged = { ...existing, ...(incoming ?? {}) }

  if (existing['force'] === true || incoming?.['force'] === true) {
    merged['force'] = true
  }

  const runIds = [
    ...(Array.isArray(existing['runIds']) ? existing['runIds'] : []),
    ...(Array.isArray(incoming?.['runIds']) ? incoming['runIds'] : []),
  ].filter((value): value is string => typeof value === 'string')
  if (runIds.length > 0) {
    merged['runIds'] = [...new Set(runIds)]
  }

  return Object.keys(merged).length > 0 ? JSON.stringify(merged) : null
}

function parseObjectJson(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
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
        payload = NULL,
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
        payload = CASE WHEN @status = 'failed' THEN NULL ELSE payload END,
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

export function initializeJevAssessment(input: {
  did: string
  rkey: string
  uri: string
  displayName: string
  inputIdentity: string
}): void {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO jev_assessments
      (did, rkey, uri, display_name, input_identity, result_input_identity, status, published_tier, label_status, updated_at)
    VALUES
      (@did, @rkey, @uri, @displayName, @inputIdentity, NULL, 'queued', NULL, 'none', @now)
    ON CONFLICT(did) DO UPDATE SET
      rkey = excluded.rkey,
      uri = excluded.uri,
      display_name = excluded.display_name,
      status = CASE
        WHEN jev_assessments.input_identity != excluded.input_identity THEN 'queued'
        WHEN jev_assessments.status IN ('awaiting-configuration', 'awaiting-pds-resolution', 'failed', 'legacy-stale') THEN 'queued'
        ELSE jev_assessments.status
      END,
      label_status = CASE
        WHEN jev_assessments.input_identity != excluded.input_identity AND jev_assessments.published_tier IS NOT NULL THEN 'stale'
        ELSE jev_assessments.label_status
      END,
      input_identity = excluded.input_identity,
      last_error = CASE WHEN jev_assessments.input_identity != excluded.input_identity THEN NULL ELSE jev_assessments.last_error END,
      updated_at = @now
  `).run({ ...input, now })
}

export function getJevAssessment(did: string): JevAssessmentRecord | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT did, rkey, uri, display_name, input_identity, result_input_identity, model,
      question_version, policy_version, probabilities, status, published_tier,
      label_status, last_error, updated_at, assessed_at
    FROM jev_assessments WHERE did = ?
  `).get(did) as JevAssessmentRow | undefined
  return row ? jevAssessmentRowToEntry(row) : null
}

export function getAllJevAssessments(): JevAssessmentRecord[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT did, rkey, uri, display_name, input_identity, result_input_identity, model,
      question_version, policy_version, probabilities, status, published_tier,
      label_status, last_error, updated_at, assessed_at
    FROM jev_assessments ORDER BY updated_at DESC
  `).all() as JevAssessmentRow[]
  return rows.map(jevAssessmentRowToEntry)
}

export function setJevAssessmentStatus(
  did: string,
  status: JevAssessmentStatus,
  errorMessage: string | null = null,
): void {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(`
    UPDATE jev_assessments
    SET status = @status,
        label_status = CASE WHEN published_tier IS NULL THEN 'none' ELSE 'stale' END,
        last_error = @errorMessage,
        updated_at = @now
    WHERE did = @did
  `).run({ did, status, errorMessage: errorMessage?.slice(0, 1000) ?? null, now })
}

export function saveJevAssessment(input: {
  did: string
  inputIdentity: string
  model: string | null
  questionVersion: string
  policyVersion: string
  probabilities: object
  status: 'assessed' | 'uncertain'
  tier: RuntimeLabelTier | null
}): boolean {
  const db = getDb()
  return db.transaction(() => {
    const current = db.prepare(`
      SELECT assessments.rkey, assessments.uri
      FROM jev_assessments AS assessments
      JOIN organization_snapshots AS snapshots
        ON snapshots.did = assessments.did
        AND snapshots.rkey = assessments.rkey
        AND snapshots.record_uri = assessments.uri
      LEFT JOIN pending_organization_deletes AS deletes ON deletes.did = assessments.did
      WHERE assessments.did = @did
        AND assessments.input_identity = @inputIdentity
        AND deletes.did IS NULL
    `).get({ did: input.did, inputIdentity: input.inputIdentity })

    if (!current) return false

    const now = new Date().toISOString()
    db.prepare(`
      UPDATE jev_assessments
      SET result_input_identity = @inputIdentity,
          model = @model,
          question_version = @questionVersion,
          policy_version = @policyVersion,
          probabilities = @probabilities,
          status = @status,
          published_tier = COALESCE(@tier, published_tier),
          label_status = CASE
            WHEN @tier IS NOT NULL THEN 'current'
            WHEN published_tier IS NOT NULL THEN 'stale'
            ELSE 'none'
          END,
          last_error = NULL,
          assessed_at = @now,
          updated_at = @now
      WHERE did = @did AND input_identity = @inputIdentity
    `).run({
      did: input.did,
      inputIdentity: input.inputIdentity,
      model: input.model,
      questionVersion: input.questionVersion,
      policyVersion: input.policyVersion,
      probabilities: JSON.stringify(input.probabilities),
      status: input.status,
      tier: input.tier,
      now,
    })
    return true
  })()
}

export interface AdminSessionRecord {
  did: string
  csrfHash: string
  expiresAt: string
}

export function insertAdminSession(input: {
  tokenHash: string
  did: string
  csrfHash: string
  expiresAt: string
}): void {
  getDb().prepare(`
    INSERT INTO admin_sessions (token_hash, did, csrf_hash, expires_at)
    VALUES (@tokenHash, @did, @csrfHash, @expiresAt)
  `).run(input)
}

export function getAdminSessionByTokenHash(tokenHash: string): AdminSessionRecord | null {
  const row = getDb().prepare(`
    SELECT did, csrf_hash, expires_at
    FROM admin_sessions
    WHERE token_hash = ?
  `).get(tokenHash) as { did: string; csrf_hash: string; expires_at: string } | undefined
  return row ? { did: row.did, csrfHash: row.csrf_hash, expiresAt: row.expires_at } : null
}

export function deleteAdminSession(tokenHash: string): void {
  getDb().prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash)
}

export function deleteExpiredAdminSessions(now = new Date().toISOString()): number {
  return getDb().prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now).changes
}

export interface AdminOAuthStateRecord {
  browserHash: string
  encryptedState: string
  expiresAt: string
}

export function insertAdminOAuthState(input: {
  stateHash: string
  browserHash: string
  encryptedState: string
  expiresAt: string
}): void {
  getDb().prepare(`
    INSERT INTO admin_oauth_states (state_hash, browser_hash, encrypted_state, expires_at)
    VALUES (@stateHash, @browserHash, @encryptedState, @expiresAt)
  `).run(input)
}

export function getAdminOAuthState(stateHash: string): AdminOAuthStateRecord | null {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare('DELETE FROM admin_oauth_states WHERE expires_at <= ?').run(now)
  const row = db.prepare(`
    SELECT browser_hash, encrypted_state, expires_at
    FROM admin_oauth_states
    WHERE state_hash = ? AND expires_at > ?
  `).get(stateHash, now) as {
    browser_hash: string
    encrypted_state: string
    expires_at: string
  } | undefined
  return row ? {
    browserHash: row.browser_hash,
    encryptedState: row.encrypted_state,
    expiresAt: row.expires_at,
  } : null
}

export function takeAdminOAuthState(stateHash: string): AdminOAuthStateRecord | null {
  const db = getDb()
  return db.transaction(() => {
    const now = new Date().toISOString()
    const row = db.prepare(`
      SELECT browser_hash, encrypted_state, expires_at
      FROM admin_oauth_states
      WHERE state_hash = ?
    `).get(stateHash) as {
      browser_hash: string
      encrypted_state: string
      expires_at: string
    } | undefined
    if (!row) return null
    db.prepare('DELETE FROM admin_oauth_states WHERE state_hash = ?').run(stateHash)
    if (row.expires_at <= now) return null
    return {
      browserHash: row.browser_hash,
      encryptedState: row.encrypted_state,
      expiresAt: row.expires_at,
    }
  })()
}

export function deleteAdminOAuthState(stateHash: string): void {
  getDb().prepare('DELETE FROM admin_oauth_states WHERE state_hash = ?').run(stateHash)
}

export function deleteExpiredAdminOAuthStates(now = new Date().toISOString()): number {
  return getDb().prepare('DELETE FROM admin_oauth_states WHERE expires_at <= ?').run(now).changes
}

export function startReassessmentRun(startedByDid: string): { started: boolean; run: ReassessmentRun } {
  const db = getDb()
  const result = db.transaction(() => {
    const active = db.prepare(`
      SELECT id FROM reassessment_runs WHERE status = 'running' LIMIT 1
    `).get() as { id: string } | undefined
    if (active) {
      return { started: false, id: active.id }
    }

    const id = randomUUID()
    db.prepare(`
      INSERT INTO reassessment_runs (id, status, started_by_did, started_at, finished_at)
      VALUES (?, 'running', ?, datetime('now'), NULL)
    `).run(id, startedByDid)

    const snapshots = db.prepare('SELECT did FROM organization_snapshots ORDER BY did').all() as Array<{ did: string }>
    for (const snapshot of snapshots) {
      db.prepare(`
        INSERT INTO reassessment_run_items (run_id, did, status, updated_at)
        VALUES (?, ?, 'pending', datetime('now'))
      `).run(id, snapshot.did)
      enqueueRecomputeJobInTransaction(db, 'recompute-org', snapshot.did, {
        delayMs: 0,
        payload: { force: true, runIds: [id], reason: 'admin-reassessment' },
      })
    }

    completeReassessmentRunsWithNoPendingItems(db)
    return { started: true, id }
  })()

  const run = getReassessmentRun(result.id)
  if (!run) throw new Error('Reassessment run was not persisted')
  return { started: result.started, run }
}

export function updateReassessmentRunItem(
  runId: string,
  did: string,
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped',
): void {
  const db = getDb()
  db.prepare(`
    UPDATE reassessment_run_items
    SET status = @status, updated_at = datetime('now')
    WHERE run_id = @runId AND did = @did
  `).run({ runId, did, status })
  completeReassessmentRunsWithNoPendingItems(db)
}

export function getReassessmentRun(id: string): ReassessmentRun | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT runs.id, runs.status, runs.started_by_did, runs.started_at, runs.finished_at,
      COUNT(items.did) AS total,
      SUM(CASE WHEN items.status IN ('completed', 'failed', 'skipped') THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN items.status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN items.status = 'skipped' THEN 1 ELSE 0 END) AS skipped
    FROM reassessment_runs AS runs
    LEFT JOIN reassessment_run_items AS items ON items.run_id = runs.id
    WHERE runs.id = ?
    GROUP BY runs.id
  `).get(id) as ReassessmentRunRow | undefined
  return row ? reassessmentRunRowToEntry(row) : null
}

export function getActiveReassessmentRun(): ReassessmentRun | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT id FROM reassessment_runs WHERE status = 'running' LIMIT 1
  `).get() as { id: string } | undefined
  return row ? getReassessmentRun(row.id) : null
}

function completeReassessmentRunsWithNoPendingItems(db: Database.Database): void {
  db.prepare(`
    UPDATE reassessment_runs
    SET status = 'completed', finished_at = datetime('now')
    WHERE status = 'running'
      AND NOT EXISTS (
        SELECT 1 FROM reassessment_run_items
        WHERE run_id = reassessment_runs.id AND status IN ('pending', 'running')
      )
  `).run()
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
 * Expired final rows become pending without discarding their last resolution value.
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
 * failures and status='failed' only after the configured hard-failure threshold.
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

/** Returns the active cached evidence state for normalized public URLs. */
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

/** Returns persisted URL evidence, including the last final result preserved on pending retries. */
export function getPersistedUrlResolutionMap(normalizedUrls: string[]): UrlResolutionMap {
  const db = getDb()
  const uniqueUrls = [...new Set(normalizedUrls)].filter(url => url.length > 0)
  if (uniqueUrls.length === 0) return {}

  const placeholders = uniqueUrls.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT normalized_url, status, resolvable
    FROM url_checks
    WHERE normalized_url IN (${placeholders})
  `).all(...uniqueUrls) as Array<{ normalized_url: string; status: UrlCheckStatus; resolvable: number | null }>

  const states: UrlResolutionMap = {}
  for (const row of rows) {
    const state = persistedUrlCheckStatusToResolutionState(row.status, row.resolvable)
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

function persistedUrlCheckStatusToResolutionState(
  status: UrlCheckStatus,
  resolvable: number | null,
): UrlResolutionState {
  // Pending retries retain the prior final result in resolvable; null means no prior result.
  if (status === 'pending' && resolvable !== null) {
    return resolvable === 1 ? 'ok' : 'failed'
  }
  return urlCheckStatusToResolutionState(status)
}

export interface AssessmentFeedFilters {
  limit?: number
  offset?: number
  tier?: RuntimeLabelTier | null
  query?: string | null
}

export function getAssessmentFeedPage(filters: AssessmentFeedFilters = {}): {
  assessments: AssessmentFeedEntry[]
  total: number
} {
  const db = getDb()
  const limit = Math.max(1, Math.min(Math.floor(filters.limit ?? 20) || 20, 100))
  const offset = Math.max(0, Math.floor(filters.offset ?? 0))
  const clauses: string[] = []
  const parameters: string[] = []

  if (filters.tier) {
    clauses.push('a.published_tier = ?')
    parameters.push(filters.tier)
  }
  const query = filters.query?.trim()
  if (query) {
    clauses.push(`(
      COALESCE(a.display_name, json_extract(p.payload, '$.displayName'), org.did) LIKE ?
      OR org.did LIKE ?
      OR org.record_uri LIKE ?
    )`)
    const pattern = `%${query}%`
    parameters.push(pattern, pattern, pattern)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db.prepare(`
    SELECT
      org.did,
      org.rkey,
      org.record_uri AS uri,
      COALESCE(a.display_name, json_extract(p.payload, '$.displayName'), org.did) AS display_name,
      COALESCE(a.status, 'queued') AS status,
      a.published_tier,
      COALESCE(a.label_status, 'none') AS label_status,
      a.model,
      a.question_version,
      a.policy_version,
      CASE WHEN a.result_input_identity = a.input_identity AND a.status IN ('assessed', 'uncertain')
        THEN a.probabilities ELSE NULL END AS probabilities,
      COALESCE(a.updated_at, org.updated_at) AS updated_at,
      a.assessed_at,
      p.validation_notes
    FROM organization_snapshots org
    LEFT JOIN jev_assessments a ON a.did = org.did
    LEFT JOIN profile_snapshots p ON p.did = org.did
    ${where}
    ORDER BY COALESCE(a.updated_at, org.updated_at) DESC, org.did ASC
    LIMIT ? OFFSET ?
  `).all(...parameters, limit, offset) as Array<Record<string, unknown>>
  const total = (db.prepare(`
    SELECT COUNT(*) AS count
    FROM organization_snapshots org
    LEFT JOIN jev_assessments a ON a.did = org.did
    LEFT JOIN profile_snapshots p ON p.did = org.did
    ${where}
  `).get(...parameters) as { count: number }).count

  return {
    assessments: rows.map(rowToAssessmentFeedEntry),
    total,
  }
}

export function getStats(): LabelStats {
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) AS count FROM organization_snapshots').get() as { count: number }).count
  const recency = db.prepare(`
    SELECT
      SUM(CASE WHEN julianday(updated_at) > julianday('now', '-1 day') THEN 1 ELSE 0 END) AS last_24h,
      SUM(CASE WHEN julianday(updated_at) > julianday('now', '-7 days') THEN 1 ELSE 0 END) AS last_7d
    FROM organization_snapshots
  `).get() as { last_24h: number | null; last_7d: number | null }
  const tierRows = db.prepare(`
    SELECT a.published_tier AS tier, COUNT(*) AS count
    FROM jev_assessments a
    JOIN organization_snapshots org ON org.did = a.did
    WHERE a.published_tier IS NOT NULL
    GROUP BY a.published_tier
  `).all() as Array<{ tier: string; count: number }>
  const statusRows = db.prepare(`
    SELECT COALESCE(a.status, 'queued') AS status, COUNT(*) AS count
    FROM organization_snapshots org
    LEFT JOIN jev_assessments a ON a.did = org.did
    GROUP BY COALESCE(a.status, 'queued')
  `).all() as Array<{ status: string; count: number }>
  const staleLabels = (db.prepare(`
    SELECT COUNT(*) AS count
    FROM jev_assessments a
    JOIN organization_snapshots org ON org.did = a.did
    WHERE a.published_tier IS NOT NULL AND a.label_status = 'stale'
  `).get() as { count: number }).count

  const byTier: LabelStats['byTier'] = {
    'likely-test': 0,
    standard: 0,
    'high-quality': 0,
  }
  for (const row of tierRows) {
    if (row.tier in byTier) byTier[row.tier as RuntimeLabelTier] = row.count
  }

  const byAssessmentStatus: LabelStats['byAssessmentStatus'] = {
    queued: 0,
    assessing: 0,
    assessed: 0,
    uncertain: 0,
    'awaiting-configuration': 0,
    'awaiting-pds-resolution': 0,
    failed: 0,
    'legacy-stale': 0,
  }
  for (const row of statusRows) {
    if (row.status in byAssessmentStatus) byAssessmentStatus[row.status as JevAssessmentStatus] = row.count
  }

  return {
    total,
    byTier,
    byAssessmentStatus,
    staleLabels,
    last24h: recency.last_24h ?? 0,
    last7d: recency.last_7d ?? 0,
  }
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

function jevAssessmentRowToEntry(row: JevAssessmentRow): JevAssessmentRecord {
  let probabilities: Record<string, unknown> | null = null
  if (row.probabilities) {
    try {
      const parsed: unknown = JSON.parse(row.probabilities)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        probabilities = parsed as Record<string, unknown>
      }
    } catch {
      probabilities = null
    }
  }

  return {
    did: row.did,
    rkey: row.rkey,
    uri: row.uri,
    displayName: row.display_name,
    inputIdentity: row.input_identity,
    resultInputIdentity: row.result_input_identity,
    model: row.model,
    questionVersion: row.question_version,
    policyVersion: row.policy_version,
    probabilities,
    status: row.status as JevAssessmentStatus,
    publishedTier: row.published_tier as RuntimeLabelTier | null,
    labelStatus: row.label_status as PublishedLabelStatus,
    lastError: row.last_error,
    updatedAt: row.updated_at,
    assessedAt: row.assessed_at,
  }
}

function reassessmentRunRowToEntry(row: ReassessmentRunRow): ReassessmentRun {
  return {
    id: row.id,
    status: row.status as ReassessmentRun['status'],
    startedByDid: row.started_by_did,
    total: row.total ?? 0,
    completed: row.completed ?? 0,
    failed: row.failed ?? 0,
    skipped: row.skipped ?? 0,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
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

function rowToAssessmentFeedEntry(row: Record<string, unknown>): AssessmentFeedEntry {
  let probabilities: Record<string, unknown> | null = null
  if (typeof row['probabilities'] === 'string') {
    try {
      const parsed: unknown = JSON.parse(row['probabilities'])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        probabilities = parsed as Record<string, unknown>
      }
    } catch {
      probabilities = null
    }
  }

  return {
    did: row['did'] as string,
    rkey: row['rkey'] as string,
    uri: row['uri'] as string,
    displayName: row['display_name'] as string,
    validationNotes: parseValidationNotes(row['validation_notes'] as string | null | undefined) ?? [],
    status: row['status'] as JevAssessmentStatus,
    publishedTier: (row['published_tier'] as RuntimeLabelTier | null) ?? null,
    labelStatus: row['label_status'] as AssessmentFeedEntry['labelStatus'],
    model: (row['model'] as string | null) ?? null,
    questionVersion: (row['question_version'] as string | null) ?? null,
    policyVersion: (row['policy_version'] as string | null) ?? null,
    probabilities,
    updatedAt: row['updated_at'] as string,
    assessedAt: (row['assessed_at'] as string | null) ?? null,
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
