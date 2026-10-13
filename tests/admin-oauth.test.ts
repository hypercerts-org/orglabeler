import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ADMIN_OAUTH_FLOW_COOKIE_NAME } from '../src/lib/admin-constants'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-admin-oauth-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')
process.env.ADMIN_DIDS = 'did:web:admin.example'
process.env.ADMIN_ORIGIN = 'https://orglabeler.example'
process.env.ADMIN_OAUTH_ENCRYPTION_KEY = 'a3'.repeat(32)
Reflect.set(process.env, 'NODE_ENV', 'production')
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const signingKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
process.env.ADMIN_OAUTH_SIGNING_KEY = Buffer.from(signingKeyPem).toString('base64')

let tokenSub = 'did:web:admin.example'
let tokenScope = 'atproto'
const parRequests: URLSearchParams[] = []
const revocationRequests: URLSearchParams[] = []
const realFetch = globalThis.fetch

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(input, init)
  const url = new URL(request.url)
  const body = request.method === 'GET' ? '' : await request.clone().text()

  if (url.pathname.endsWith('/.well-known/did.json')) {
    const did = `did:web:${url.hostname}`
    return json({
      '@context': 'https://www.w3.org/ns/did/v1',
      id: did,
      service: [{
        id: `${did}#atproto_pds`,
        type: 'AtprotoPersonalDataServer',
        serviceEndpoint: 'https://pds.example',
      }],
    })
  }
  if (url.pathname.endsWith('/.well-known/oauth-protected-resource')) {
    return json({ resource: 'https://pds.example', authorization_servers: ['https://as.example'] })
  }
  if (url.pathname.endsWith('/.well-known/oauth-authorization-server')) {
    return json({
      issuer: 'https://as.example',
      authorization_endpoint: 'https://as.example/authorize',
      token_endpoint: 'https://as.example/token',
      pushed_authorization_request_endpoint: 'https://as.example/par',
      revocation_endpoint: 'https://as.example/revoke',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['private_key_jwt'],
      token_endpoint_auth_signing_alg_values_supported: ['ES256'],
      dpop_signing_alg_values_supported: ['ES256'],
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
      require_pushed_authorization_requests: true,
    })
  }
  if (url.pathname === '/par') {
    parRequests.push(new URLSearchParams(body))
    return json({ request_uri: 'urn:ietf:params:oauth:request_uri:test', expires_in: 90 })
  }
  if (url.pathname === '/token') {
    return json({
      access_token: 'temporary-access-token',
      refresh_token: 'temporary-refresh-token',
      token_type: 'DPoP',
      scope: tokenScope,
      sub: tokenSub,
      expires_in: 3600,
    })
  }
  if (url.pathname === '/revoke') {
    revocationRequests.push(new URLSearchParams(body))
    return json({})
  }
  return json({ error: `unexpected_mock_request:${url.href}` }, 404)
}) as typeof fetch

const { closeDb, getDb } = await import('../src/lib/db')
const { GET: metadataGet } = await import('../src/app/api/admin/oauth/client-metadata/route')
const { GET: jwksGet } = await import('../src/app/api/admin/oauth/jwks/route')
const { POST: loginPost } = await import('../src/app/api/admin/oauth/login/route')
const { GET: callbackGet } = await import('../src/app/api/admin/oauth/callback/route')

after(() => {
  closeDb()
  globalThis.fetch = realFetch
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  tokenSub = 'did:web:admin.example'
  tokenScope = 'atproto'
  parRequests.length = 0
  revocationRequests.length = 0
  getDb().exec('DELETE FROM admin_sessions; DELETE FROM admin_oauth_states;')
})

test('OAuth metadata and public JWKS expose a confidential client with only atproto scope', async () => {
  const metadataResponse = await metadataGet()
  assert.equal(metadataResponse.status, 200)
  const metadata = await metadataResponse.json() as Record<string, unknown>
  assert.equal(metadata.client_id, 'https://orglabeler.example/api/admin/oauth/client-metadata')
  assert.deepEqual(metadata.redirect_uris, ['https://orglabeler.example/api/admin/oauth/callback'])
  assert.equal(metadata.scope, 'atproto')
  assert.equal(metadata.token_endpoint_auth_method, 'private_key_jwt')
  assert.equal(metadata.jwks_uri, 'https://orglabeler.example/api/admin/oauth/jwks')

  const jwksResponse = await jwksGet()
  assert.equal(jwksResponse.status, 200)
  const jwks = await jwksResponse.json() as { keys: Array<Record<string, unknown>> }
  assert.equal(jwks.keys.length, 1)
  assert.equal(jwks.keys[0]?.crv, 'P-256')
  assert.equal('d' in (jwks.keys[0] ?? {}), false)
})

test('login sends only atproto through PAR and binds encrypted single-use state to the browser cookie', async () => {
  const response = await startLogin('did:web:admin.example')
  assert.equal(response.status, 303)
  assert.equal(new URL(response.headers.get('location') ?? '').origin, 'https://as.example')
  assert.equal(parRequests.length, 1)
  const authorization = parRequests[0]!
  assert.equal(authorization.get('scope'), 'atproto')
  assert.equal(authorization.get('code_challenge_method'), 'S256')
  assert.ok(authorization.get('code_challenge'))
  assert.equal(authorization.get('client_id'), 'https://orglabeler.example/api/admin/oauth/client-metadata')
  assert.equal(authorization.get('redirect_uri'), 'https://orglabeler.example/api/admin/oauth/callback')
  assert.ok((authorization.get('state')?.length ?? 0) >= 22)
  assert.equal(authorization.has('transition:generic'), false)

  const setCookie = response.headers.get('set-cookie') ?? ''
  assert.match(setCookie, new RegExp(`${ADMIN_OAUTH_FLOW_COOKIE_NAME}=[A-Za-z0-9_-]{43}`))
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /SameSite=Lax/i)
  assert.match(setCookie, /Secure/)

  const stateRow = getDb().prepare('SELECT encrypted_state, browser_hash FROM admin_oauth_states').get() as {
    encrypted_state: string
    browser_hash: string
  }
  assert.match(stateRow.encrypted_state, /^v1\./)
  assert.equal(stateRow.browser_hash.length, 64)
  assert.doesNotMatch(stateRow.encrypted_state, /temporary|verifier|dpop/i)
})

test('verified allowlisted callback creates a local session, consumes state once, and attempts revocation', async () => {
  const login = await startLogin('did:web:admin.example')
  const { state, browserToken } = loginState(login)
  tokenSub = 'did:web:admin.example'
  const callbackUrl = new URL('https://orglabeler.example/api/admin/oauth/callback')
  callbackUrl.search = new URLSearchParams({ state, code: 'mock-code', iss: 'https://as.example' }).toString()

  const malformedUrl = new URL(callbackUrl)
  malformedUrl.searchParams.delete('code')
  malformedUrl.searchParams.delete('iss')
  const malformed = await callbackGet(new Request(malformedUrl, {
    headers: { cookie: `${ADMIN_OAUTH_FLOW_COOKIE_NAME}=${browserToken}` },
  }))
  assert.match(malformed.headers.get('location') ?? '', /login=failed/)
  assert.doesNotMatch(malformed.headers.get('set-cookie') ?? '', new RegExp(`${ADMIN_OAUTH_FLOW_COOKIE_NAME}=;`))
  assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM admin_oauth_states').get() as { count: number }).count, 1)

  const response = await callbackGet(new Request(callbackUrl, {
    headers: { cookie: `${ADMIN_OAUTH_FLOW_COOKIE_NAME}=${browserToken}` },
  }))
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), 'https://orglabeler.example/admin')
  assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM admin_sessions').get() as { count: number }).count, 1)
  assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM admin_oauth_states').get() as { count: number }).count, 0)
  assert.match(response.headers.get('set-cookie') ?? '', /orglabeler_admin_session=.*HttpOnly/)
  const setCookie = response.headers.get('set-cookie') ?? ''
  assert.match(setCookie, /SameSite=Lax/i)
  assert.match(setCookie, new RegExp(`${ADMIN_OAUTH_FLOW_COOKIE_NAME}=;`))
  assert.match(setCookie, /Max-Age=0/)
  assert.equal(revocationRequests.length, 1)
  assert.equal(revocationRequests[0]?.get('token'), 'temporary-access-token')

  const replay = await callbackGet(new Request(callbackUrl, {
    headers: { cookie: `${ADMIN_OAUTH_FLOW_COOKIE_NAME}=${browserToken}` },
  }))
  assert.match(replay.headers.get('location') ?? '', /login=failed/)
  assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM admin_sessions').get() as { count: number }).count, 1)
})

test('wrong-browser, expired, malformed, and provider-error callbacks fail closed', async () => {
  const wrongBrowserLogin = await startLogin('did:web:admin.example')
  const wrongBrowser = loginState(wrongBrowserLogin)
  const wrongBrowserUrl = callbackUrl(wrongBrowser.state)
  const wrongBrowserResponse = await callbackGet(new Request(wrongBrowserUrl, {
    headers: { cookie: `${ADMIN_OAUTH_FLOW_COOKIE_NAME}=${'x'.repeat(43)}` },
  }))
  assert.match(wrongBrowserResponse.headers.get('location') ?? '', /login=failed/)
  assert.doesNotMatch(wrongBrowserResponse.headers.get('set-cookie') ?? '', new RegExp(`${ADMIN_OAUTH_FLOW_COOKIE_NAME}=;`))
  assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM admin_oauth_states').get() as { count: number }).count, 1)

  const expiredLogin = await startLogin('did:web:admin.example')
  const expired = loginState(expiredLogin)
  getDb().prepare('UPDATE admin_oauth_states SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString())
  const expiredResponse = await callbackGet(new Request(callbackUrl(expired.state), {
    headers: { cookie: `${ADMIN_OAUTH_FLOW_COOKIE_NAME}=${expired.browserToken}` },
  }))
  assert.match(expiredResponse.headers.get('location') ?? '', /login=failed/)

  const malformed = await callbackGet(new Request('https://orglabeler.example/api/admin/oauth/callback?code=missing-state'))
  assert.match(malformed.headers.get('location') ?? '', /login=failed/)
  assert.equal(malformed.headers.get('set-cookie'), null)

  const providerErrorLogin = await startLogin('did:web:admin.example')
  const providerError = loginState(providerErrorLogin)
  const errorUrl = new URL(callbackUrl(providerError.state))
  errorUrl.searchParams.delete('code')
  errorUrl.searchParams.set('error', 'access_denied')
  errorUrl.searchParams.set('iss', 'https://as.example')
  const providerErrorResponse = await callbackGet(new Request(errorUrl, {
    headers: { cookie: `${ADMIN_OAUTH_FLOW_COOKIE_NAME}=${providerError.browserToken}` },
  }))
  assert.match(providerErrorResponse.headers.get('location') ?? '', /login=failed/)
  assert.match(providerErrorResponse.headers.get('set-cookie') ?? '', new RegExp(`${ADMIN_OAUTH_FLOW_COOKIE_NAME}=;`))

  const wrongIssuerLogin = await startLogin('did:web:admin.example')
  const wrongIssuer = loginState(wrongIssuerLogin)
  const wrongIssuerUrl = callbackUrl(wrongIssuer.state)
  wrongIssuerUrl.searchParams.set('iss', 'https://attacker.example')
  const wrongIssuerResponse = await callbackGet(new Request(wrongIssuerUrl, {
    headers: { cookie: `${ADMIN_OAUTH_FLOW_COOKIE_NAME}=${wrongIssuer.browserToken}` },
  }))
  assert.match(wrongIssuerResponse.headers.get('location') ?? '', /login=failed/)
  assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM admin_sessions').get() as { count: number }).count, 0)
})

test('callback rejects an unexpected non-allowlisted DID and refuses a scope broader than atproto', async () => {
  const requestCount = parRequests.length
  const deniedLogin = await startLogin('did:web:denied.example')
  assert.match(deniedLogin.headers.get('location') ?? '', /login=not-allowed/)
  assert.equal(parRequests.length, requestCount)

  const mismatchedLogin = await startLogin('did:web:admin.example')
  const mismatched = loginState(mismatchedLogin)
  tokenSub = 'did:web:denied.example'
  const deniedResponse = await callbackGet(new Request(callbackUrl(mismatched.state), {
    headers: { cookie: `${ADMIN_OAUTH_FLOW_COOKIE_NAME}=${mismatched.browserToken}` },
  }))
  assert.match(deniedResponse.headers.get('location') ?? '', /login=failed/)
  assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM admin_sessions').get() as { count: number }).count, 0)

  const scopeLogin = await startLogin('did:web:admin.example')
  const broadScope = loginState(scopeLogin)
  tokenSub = 'did:web:admin.example'
  tokenScope = 'atproto transition:generic'
  const scopeResponse = await callbackGet(new Request(callbackUrl(broadScope.state), {
    headers: { cookie: `${ADMIN_OAUTH_FLOW_COOKIE_NAME}=${broadScope.browserToken}` },
  }))
  assert.match(scopeResponse.headers.get('location') ?? '', /login=failed/)
  assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM admin_sessions').get() as { count: number }).count, 0)
})

test('login initiation requires exact origin and missing OAuth configuration fails closed', async () => {
  const rejected = await loginPost(new Request('https://orglabeler.example/api/admin/oauth/login', {
    method: 'POST',
    headers: { origin: 'https://attacker.example', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'identifier=did%3Aweb%3Aadmin.example',
  }))
  assert.equal(rejected.status, 403)
  assert.equal(parRequests.length, 0)
})

async function startLogin(identifier: string): Promise<Response> {
  return loginPost(new Request('https://orglabeler.example/api/admin/oauth/login', {
    method: 'POST',
    headers: { origin: 'https://orglabeler.example', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ identifier }),
  }))
}

function loginState(response: Response): { state: string; browserToken: string } {
  const authorization = parRequests.at(-1)
  assert.ok(authorization)
  const state = authorization.get('state')
  assert.ok(state)
  const setCookie = response.headers.get('set-cookie') ?? ''
  const match = setCookie.match(new RegExp(`${ADMIN_OAUTH_FLOW_COOKIE_NAME}=([A-Za-z0-9_-]{43})`))
  assert.ok(match)
  return { state, browserToken: match[1]! }
}

function callbackUrl(state: string): URL {
  const url = new URL('https://orglabeler.example/api/admin/oauth/callback')
  url.search = new URLSearchParams({ state, code: 'mock-code', iss: 'https://as.example' }).toString()
  return url
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
