import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { OrganizationSnapshot } from '../src/lib/types'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-pending-deletes-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')

const {
  closeDb,
  completePendingOrganizationDelete,
  deletePendingOrganizationDelete,
  getDb,
  getOrganizationSnapshot,
  hasPendingOrganizationDelete,
  upsertOrganizationSnapshot,
  upsertPendingOrganizationDelete,
} = await import('../src/lib/db')

beforeEach(() => {
  getDb().exec(`
    DELETE FROM activities;
    DELETE FROM organization_snapshots;
    DELETE FROM pending_organization_deletes;
  `)
})

after(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

function organizationPayload(): OrganizationSnapshot['payload'] {
  return {
    $type: 'app.certified.actor.organization',
    organizationType: ['ngo'],
    createdAt: '2024-01-01T00:00:00.000Z',
  }
}

test('completing a pending delete removes only the matching local organization state', () => {
  const did = 'did:example:delete'
  const rkey = 'self'
  const recordUri = `at://${did}/app.certified.actor.organization/${rkey}`

  upsertOrganizationSnapshot({
    did,
    rkey,
    recordUri,
    payload: organizationPayload(),
  })
  upsertPendingOrganizationDelete(did, rkey, recordUri)

  assert.equal(completePendingOrganizationDelete(did, rkey, recordUri), true)
  assert.equal(getOrganizationSnapshot(did), null)
  assert.equal(hasPendingOrganizationDelete(did), false)
})

test('stale pending delete cleanup does not remove a newer replacement snapshot', () => {
  const did = 'did:example:delete-race'
  const staleRkey = 'old'
  const staleUri = `at://${did}/app.certified.actor.organization/${staleRkey}`
  const freshRkey = 'self'
  const freshUri = `at://${did}/app.certified.actor.organization/${freshRkey}`

  upsertPendingOrganizationDelete(did, staleRkey, staleUri)

  deletePendingOrganizationDelete(did)
  upsertOrganizationSnapshot({
    did,
    rkey: freshRkey,
    recordUri: freshUri,
    payload: organizationPayload(),
  })

  assert.equal(completePendingOrganizationDelete(did, staleRkey, staleUri), false)

  const current = getOrganizationSnapshot(did)
  assert.ok(current)
  assert.equal(current.rkey, freshRkey)
  assert.equal(current.recordUri, freshUri)
})
