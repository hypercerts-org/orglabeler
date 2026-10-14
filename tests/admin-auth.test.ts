import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { OrganizationSnapshot } from '../src/lib/types'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-admin-auth-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')
process.env.ADMIN_DIDS = 'did:example:admin'
process.env.ADMIN_ORIGIN = 'https://orglabeler.example'
process.env.ADMIN_SESSION_TTL_MS = '3600000'
Reflect.set(process.env, 'NODE_ENV', 'production')

const { closeDb, getDb, getRecomputeJobCounts, getActiveReassessmentRun, upsertOrganizationSnapshot } = await import('../src/lib/db')
const {
  authorizeAdminRequest,
  getAdminSessionFromToken,
  issueAdminSessionForVerifiedDid,
  serializeAdminSessionCookies,
} = await import('../src/lib/admin-auth')
const { ADMIN_CSRF_COOKIE_NAME, ADMIN_SESSION_COOKIE_NAME } = await import('../src/lib/admin-constants')
const { GET, POST } = await import('../src/app/api/admin/reassessment/route')
const { POST: logout } = await import('../src/app/api/admin/logout/route')

after(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  getDb().exec(`
    DELETE FROM profile_snapshots;
    DELETE FROM organization_snapshots;
    DELETE FROM pending_organization_deletes;
    DELETE FROM recompute_jobs;
    DELETE FROM actor_pds_cache;
    DELETE FROM url_checks;
    DELETE FROM jev_assessments;
    DELETE FROM reassessment_run_items;
    DELETE FROM reassessment_runs;
    DELETE FROM admin_sessions;
    DELETE FROM admin_oauth_states;
  `)
})

function authenticatedCookies() {
  const credentials = issueAdminSessionForVerifiedDid('did:example:admin')
  assert.ok(credentials)
  const headers = serializeAdminSessionCookies(credentials)
  const cookie = headers.map(value => value.split(';', 1)[0]).join('; ')
  return { credentials, cookie }
}

function seedOrganization(): void {
  const did = 'did:example:organization'
  upsertOrganizationSnapshot({
    did,
    rkey: 'self',
    recordUri: `at://${did}/app.certified.actor.organization/self`,
    payload: {
      $type: 'app.certified.actor.organization',
      organizationType: ['ngo'],
      createdAt: '2024-01-01T00:00:00.000Z',
    } as OrganizationSnapshot['payload'],
  })
}

test('admin sessions persist only token hashes and reject DIDs outside the allowlist', () => {
  assert.equal(issueAdminSessionForVerifiedDid('did:example:not-allowed'), null)
  const credentials = issueAdminSessionForVerifiedDid('did:example:admin')
  assert.ok(credentials)
  assert.equal(getAdminSessionFromToken(credentials.sessionToken)?.did, 'did:example:admin')

  const row = getDb().prepare('SELECT token_hash, csrf_hash FROM admin_sessions').get() as { token_hash: string; csrf_hash: string }
  assert.notEqual(row.token_hash, credentials.sessionToken)
  assert.notEqual(row.csrf_hash, credentials.csrfToken)
  assert.equal(row.token_hash.length, 64)
  assert.equal(row.csrf_hash.length, 64)
})

test('session cookies are secure, http-only for session, and SameSite protected', () => {
  const credentials = issueAdminSessionForVerifiedDid('did:example:admin')
  assert.ok(credentials)
  const cookies = serializeAdminSessionCookies(credentials)
  const sessionCookie = cookies.find(cookie => cookie.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=`))
  const csrfCookie = cookies.find(cookie => cookie.startsWith(`${ADMIN_CSRF_COOKIE_NAME}=`))

  assert.match(sessionCookie ?? '', /; HttpOnly/)
  assert.match(sessionCookie ?? '', /; Secure/)
  assert.match(sessionCookie ?? '', /; SameSite=Lax/)
  assert.match(csrfCookie ?? '', /; Secure/)
  assert.match(csrfCookie ?? '', /; SameSite=Lax/)
  assert.doesNotMatch(csrfCookie ?? '', /HttpOnly/)
})

test('HTTPS origin keeps cookies Secure in development and insecure cookies are limited to local HTTP', () => {
  const script = `
    const { serializeAdminSessionCookies } = await import('./src/lib/admin-auth.ts')
    const cookies = serializeAdminSessionCookies({
      did: 'did:example:admin',
      sessionToken: 's'.repeat(43),
      csrfToken: 'c'.repeat(43),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    })
    console.log(JSON.stringify(cookies))
  `
  const run = (origin: string) => spawnSync(process.execPath, [
    '--import', 'tsx', '--input-type=module', '-e', script,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ADMIN_ORIGIN: origin, NODE_ENV: 'development' },
  })

  const https = run('https://orglabeler.example')
  assert.equal(https.status, 0, https.stderr)
  assert.ok((JSON.parse(https.stdout) as string[]).every(cookie => /; Secure(?:;|$)/.test(cookie)))

  const localHttp = run('http://localhost')
  assert.equal(localHttp.status, 0, localHttp.stderr)
  assert.ok((JSON.parse(localHttp.stdout) as string[]).every(cookie => !/; Secure(?:;|$)/.test(cookie)))

  const invalidOrigin = run('http://example.com')
  assert.equal(invalidOrigin.status, 0, invalidOrigin.stderr)
  assert.ok((JSON.parse(invalidOrigin.stdout) as string[]).every(cookie => /; Secure(?:;|$)/.test(cookie)))
})

test('admin mutations require a valid session, exact origin, and matching CSRF token', async () => {
  const { credentials, cookie } = authenticatedCookies()
  const base = {
    method: 'POST',
    headers: { cookie, origin: 'https://orglabeler.example' },
  }

  const missingCsrf = authorizeAdminRequest(new Request('https://orglabeler.example/api/admin/reassessment', base), { mutation: true })
  assert.equal(missingCsrf.ok, false)
  if (!missingCsrf.ok) assert.equal(missingCsrf.status, 403)

  const mismatchedOrigin = authorizeAdminRequest(new Request('https://orglabeler.example/api/admin/reassessment', {
    ...base,
    headers: { ...base.headers, origin: 'https://attacker.example', 'x-csrf-token': credentials.csrfToken },
  }), { mutation: true })
  assert.equal(mismatchedOrigin.ok, false)
  if (!mismatchedOrigin.ok) assert.equal(mismatchedOrigin.status, 403)

  const mismatchedCsrf = authorizeAdminRequest(new Request('https://orglabeler.example/api/admin/reassessment', {
    ...base,
    headers: { ...base.headers, 'x-csrf-token': 'wrong-token' },
  }), { mutation: true })
  assert.equal(mismatchedCsrf.ok, false)
  if (!mismatchedCsrf.ok) assert.equal(mismatchedCsrf.status, 403)

  const absentSession = authorizeAdminRequest(new Request('https://orglabeler.example/api/admin/reassessment', {
    method: 'POST',
    headers: { origin: 'https://orglabeler.example', 'x-csrf-token': credentials.csrfToken },
  }), { mutation: true })
  assert.equal(absentSession.ok, false)
  if (!absentSession.ok) assert.equal(absentSession.status, 401)
  assert.equal(getActiveReassessmentRun(), null)
})

test('protected reassessment endpoint starts one forced durable run and rejects a duplicate', async () => {
  seedOrganization()
  const { credentials, cookie } = authenticatedCookies()
  const requestInit = {
    method: 'POST',
    headers: {
      cookie,
      origin: 'https://orglabeler.example',
      'x-csrf-token': credentials.csrfToken,
    },
  }

  const started = await POST(new Request('https://orglabeler.example/api/admin/reassessment', requestInit))
  assert.equal(started.status, 202)
  const body = await started.json() as { run: { id: string; total: number; status: string } }
  assert.equal(body.run.total, 1)
  assert.equal(body.run.status, 'running')

  const queued = getDb().prepare(`
    SELECT payload FROM recompute_jobs WHERE kind = 'recompute-org' AND key = 'did:example:organization'
  `).get() as { payload: string }
  const payload = JSON.parse(queued.payload) as { force: boolean; runIds: string[]; reason: string }
  assert.equal(payload.force, true)
  assert.deepEqual(payload.runIds, [body.run.id])
  assert.equal(payload.reason, 'admin-reassessment')

  const duplicate = await POST(new Request('https://orglabeler.example/api/admin/reassessment', requestInit))
  assert.equal(duplicate.status, 409)
  assert.equal(getRecomputeJobCounts().pending, 1)
})

test('admin requests reject a persisted session whose DID is no longer allowlisted', () => {
  const { credentials, cookie } = authenticatedCookies()
  getDb().prepare('UPDATE admin_sessions SET did = ?').run('did:example:removed')

  const response = authorizeAdminRequest(new Request('https://orglabeler.example/api/admin/reassessment', {
    headers: { cookie },
  }))
  assert.equal(response.ok, false)
  if (!response.ok) assert.equal(response.status, 401)
  assert.equal(getAdminSessionFromToken(credentials.sessionToken), null)
  assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM admin_sessions').get() as { count: number }).count, 0)
})

test('logout requires exact origin and CSRF, then revokes the session and clears cookies', async () => {
  const { credentials, cookie } = authenticatedCookies()
  const endpoint = 'https://orglabeler.example/api/admin/logout'

  const missingCsrf = await logout(new Request(endpoint, {
    method: 'POST',
    headers: { cookie, origin: 'https://orglabeler.example' },
  }))
  assert.equal(missingCsrf.status, 403)
  assert.equal(getAdminSessionFromToken(credentials.sessionToken)?.did, 'did:example:admin')

  const wrongOrigin = await logout(new Request(endpoint, {
    method: 'POST',
    headers: { cookie, origin: 'https://attacker.example', 'x-csrf-token': credentials.csrfToken },
  }))
  assert.equal(wrongOrigin.status, 403)
  assert.equal(getAdminSessionFromToken(credentials.sessionToken)?.did, 'did:example:admin')

  const signedOut = await logout(new Request(endpoint, {
    method: 'POST',
    headers: { cookie, origin: 'https://orglabeler.example', 'x-csrf-token': credentials.csrfToken },
  }))
  assert.equal(signedOut.status, 303)
  assert.equal(getAdminSessionFromToken(credentials.sessionToken), null)
  const setCookie = signedOut.headers.get('set-cookie') ?? ''
  assert.match(setCookie, /orglabeler_admin_session=;/)
  assert.match(setCookie, /Max-Age=0/)
})

test('reassessment status endpoint is private and returns the active run to an admin session', async () => {
  const unauthenticated = await GET(new Request('https://orglabeler.example/api/admin/reassessment'))
  assert.equal(unauthenticated.status, 401)

  seedOrganization()
  const { cookie } = authenticatedCookies()
  const started = await POST(new Request('https://orglabeler.example/api/admin/reassessment', {
    method: 'POST',
    headers: {
      cookie,
      origin: 'https://orglabeler.example',
      'x-csrf-token': getCsrf(cookie),
    },
  }))
  assert.equal(started.status, 202)

  const response = await GET(new Request('https://orglabeler.example/api/admin/reassessment', {
    headers: { cookie },
  }))
  assert.equal(response.status, 200)
  const body = await response.json() as { run: { total: number } }
  assert.equal(body.run.total, 1)
})

function getCsrf(cookie: string): string {
  return cookie.split('; ').find(part => part.startsWith(`${ADMIN_CSRF_COOKIE_NAME}=`))?.split('=', 2)[1] ?? ''
}
