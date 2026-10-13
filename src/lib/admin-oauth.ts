import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { JoseKey } from '@atproto/jwk-jose'
import {
  AtprotoHandleResolverNode,
  NodeOAuthClient,
  type NodeSavedSession,
  type NodeSavedState,
  type OAuthClientMetadataInput,
} from '@atproto/oauth-client-node'
import { isAdminDidAllowed } from './admin-auth'
import {
  ADMIN_DIDS_CONFIG,
  ADMIN_OAUTH_ENCRYPTION_KEY,
  ADMIN_OAUTH_SIGNING_KEY,
  ADMIN_OAUTH_STATE_TTL_MS,
  ADMIN_ORIGIN,
} from './config'
import {
  deleteAdminOAuthState,
  deleteExpiredAdminOAuthStates,
  getAdminOAuthState,
  insertAdminOAuthState,
  takeAdminOAuthState,
} from './db'

const SIGNING_KEY_ID = 'orglabeler-admin-oauth'
const HANDLE_INVALID = 'handle.invalid'
const sessionStore = new Map<string, NodeSavedSession>()
let clientPromise: Promise<NodeOAuthClient> | undefined
let callbackTail: Promise<void> = Promise.resolve()

export interface AdminOAuthFlowState {
  browserHash: string
  expectedDid: string
  expectedHandle: string | null
}

export interface VerifiedAdminOAuthState {
  flow: AdminOAuthFlowState
  issuer: string
}

export class AdminOAuthNotAllowedError extends Error {}

export function getAdminOAuthConfigurationIssue(): string | null {
  if (ADMIN_DIDS_CONFIG.error) return 'Set ADMIN_DIDS to a comma-separated list of valid admin DIDs.'
  if (!ADMIN_ORIGIN) return 'Set ADMIN_ORIGIN to the stable public HTTPS origin for this dashboard.'
  if (!ADMIN_OAUTH_SIGNING_KEY) return 'Set ADMIN_OAUTH_SIGNING_KEY to a stable base64-encoded P-256 PKCS#8 private key.'
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(ADMIN_OAUTH_SIGNING_KEY)) {
    return 'ADMIN_OAUTH_SIGNING_KEY must be standard base64-encoded PKCS#8 PEM.'
  }
  const pem = Buffer.from(ADMIN_OAUTH_SIGNING_KEY, 'base64').toString('utf8')
  if (!pem.startsWith('-----BEGIN PRIVATE KEY-----')) {
    return 'ADMIN_OAUTH_SIGNING_KEY must encode an unencrypted PKCS#8 PRIVATE KEY PEM.'
  }
  if (!/^[a-fA-F0-9]{64}$/.test(ADMIN_OAUTH_ENCRYPTION_KEY)) {
    return 'Set ADMIN_OAUTH_ENCRYPTION_KEY to exactly 64 hexadecimal characters (32 random bytes).'
  }
  return null
}

export async function getAdminOAuthClient(): Promise<NodeOAuthClient> {
  const issue = getAdminOAuthConfigurationIssue()
  if (issue) throw new Error(issue)
  if (!clientPromise) {
    clientPromise = createAdminOAuthClient().catch(error => {
      clientPromise = undefined
      throw error
    })
  }
  return clientPromise
}

async function createAdminOAuthClient(): Promise<NodeOAuthClient> {
  const issue = getAdminOAuthConfigurationIssue()
  if (issue) throw new Error(issue)

  const pem = Buffer.from(ADMIN_OAUTH_SIGNING_KEY, 'base64').toString('utf8')
  let key: JoseKey
  try {
    key = await JoseKey.fromImportable(pem, SIGNING_KEY_ID)
  } catch {
    throw new Error('ADMIN_OAUTH_SIGNING_KEY is not a valid P-256 PKCS#8 private key.')
  }
  if (
    key.jwk.kty !== 'EC' ||
    key.jwk.crv !== 'P-256' ||
    !key.privateJwk || !('d' in key.privateJwk) ||
    !key.algorithms.includes('ES256')
  ) {
    throw new Error('ADMIN_OAUTH_SIGNING_KEY must contain a P-256 key usable with ES256.')
  }

  const origin = ADMIN_ORIGIN!
  const clientMetadata: OAuthClientMetadataInput = {
    client_id: `${origin}/api/admin/oauth/client-metadata`,
    client_name: 'OrgLabeler Admin',
    client_uri: origin,
    redirect_uris: [`${origin}/api/admin/oauth/callback`],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    scope: 'atproto',
    application_type: 'web',
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    dpop_bound_access_tokens: true,
    jwks_uri: `${origin}/api/admin/oauth/jwks`,
  }

  return new NodeOAuthClient({
    clientMetadata,
    keyset: [key],
    stateStore: {
      async set(state, value) {
        const flow = parseFlowState(value.appState)
        if (!flow) throw new Error('OAuth flow state is malformed')
        deleteExpiredAdminOAuthStates()
        const stateHash = hash(state)
        insertAdminOAuthState({
          stateHash,
          browserHash: flow.browserHash,
          encryptedState: encryptState(value, stateHash),
          expiresAt: new Date(Date.now() + ADMIN_OAUTH_STATE_TTL_MS).toISOString(),
        })
      },
      async get(state) {
        const stateHash = hash(state)
        const stored = takeAdminOAuthState(stateHash)
        if (!stored) return undefined
        try {
          const value = decryptState(stored.encryptedState, stateHash)
          const flow = parseFlowState(value.appState)
          if (!flow || !constantTimeEqual(flow.browserHash, stored.browserHash)) return undefined
          return value
        } catch {
          return undefined
        }
      },
      async del(state) {
        deleteAdminOAuthState(hash(state))
      },
    },
    sessionStore: {
      async set(did, session) {
        sessionStore.set(did, session)
      },
      async get(did) {
        return sessionStore.get(did)
      },
      async del(did) {
        sessionStore.delete(did)
      },
    },
    requestLock: async <T>(_name: string, operation: () => T | PromiseLike<T>) => operation(),
  })
}

export async function beginAdminOAuthLogin(identifier: string, browserToken: string): Promise<URL> {
  const client = await getAdminOAuthClient()
  const isDid = identifier.startsWith('did:')
  let expectedDid: string
  let expectedHandle: string | null = null
  if (isDid) {
    if (!isAdminDidAllowed(identifier)) throw new AdminOAuthNotAllowedError()
    expectedDid = identifier
  } else {
    expectedHandle = identifier.toLowerCase()
    const resolvedDid = await new AtprotoHandleResolverNode().resolve(identifier)
    if (!resolvedDid) throw new Error('The supplied handle did not resolve to a DID.')
    if (!isAdminDidAllowed(resolvedDid)) throw new AdminOAuthNotAllowedError()
    expectedDid = resolvedDid
  }

  const identity = await client.identityResolver.resolve(expectedDid)
  if (identity.did !== expectedDid) throw new Error('The DID document resolved to a different DID.')
  if (expectedHandle && !identity.didDoc.alsoKnownAs?.includes(`at://${expectedHandle}`)) {
    throw new Error('The allowlisted DID does not verify the submitted handle.')
  }

  const flow: AdminOAuthFlowState = {
    browserHash: hash(browserToken),
    expectedDid,
    expectedHandle,
  }
  return client.authorize(expectedDid, {
    scope: 'atproto',
    state: JSON.stringify(flow),
  })
}

export function inspectAdminOAuthCallback(state: string, browserToken: string): VerifiedAdminOAuthState | null {
  if (!state || state.length > 512 || !/^[A-Za-z0-9._~-]+$/.test(state)) return null
  if (!/^[A-Za-z0-9_-]{43}$/.test(browserToken)) return null

  const stateHash = hash(state)
  const stored = getAdminOAuthState(stateHash)
  if (!stored) return null
  try {
    const value = decryptState(stored.encryptedState, stateHash)
    const flow = parseFlowState(value.appState)
    if (!flow || !constantTimeEqual(flow.browserHash, stored.browserHash)) return null
    if (!constantTimeEqual(flow.browserHash, hash(browserToken))) return null
    return { flow, issuer: value.iss }
  } catch {
    return null
  }
}

export async function withAdminOAuthCallbackLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = callbackTail
  let release!: () => void
  callbackTail = new Promise<void>(resolve => { release = resolve })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

export async function verifyAdminOAuthCallback(
  params: URLSearchParams,
  pending: VerifiedAdminOAuthState,
): Promise<{ did: string; revoke: () => Promise<void> }> {
  const client = await getAdminOAuthClient()
  const { session, state } = await client.callback(params, {
    redirect_uri: client.clientMetadata.redirect_uris[0],
  })
  const flow = parseFlowState(state)
  if (!flow || flow.expectedDid !== pending.flow.expectedDid || flow.browserHash !== pending.flow.browserHash) {
    await discardOAuthSession(session.did)
    throw new Error('OAuth flow state did not match the initiating browser.')
  }

  try {
    const tokenInfo = await session.getTokenInfo(false)
    if (
      session.did !== flow.expectedDid ||
      tokenInfo.sub !== session.did ||
      tokenInfo.iss !== pending.issuer ||
      tokenInfo.scope !== 'atproto'
    ) {
      throw new Error('OAuth returned an unexpected DID, issuer, or scope.')
    }

    if (flow.expectedHandle) {
      const identity = await client.identityResolver.resolve(session.did, { noCache: true })
      if (
        identity.did !== session.did ||
        !identity.didDoc.alsoKnownAs?.includes(`at://${flow.expectedHandle}`)
      ) {
        throw new Error('The authenticated DID no longer verifies the submitted handle.')
      }
    }

    return {
      did: session.did,
      revoke: async () => {
        try {
          await session.signOut()
        } finally {
          await sessionStoreDelete(session.did)
        }
      },
    }
  } catch (error) {
    await discardOAuthSession(session.did)
    throw error
  }
}

async function discardOAuthSession(did: string): Promise<void> {
  const client = await getAdminOAuthClient()
  try {
    const session = await client.restore(did, false)
    await session.signOut()
  } catch {
    await sessionStoreDelete(did)
  }
}

async function sessionStoreDelete(did: string): Promise<void> {
  sessionStore.delete(did)
}

function parseFlowState(value: string | null | undefined): AdminOAuthFlowState | null {
  if (!value || value.length > 2048) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const flow = parsed as Partial<AdminOAuthFlowState>
    if (
      typeof flow.browserHash !== 'string' || !/^[a-f0-9]{64}$/.test(flow.browserHash) ||
      typeof flow.expectedDid !== 'string' || !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(flow.expectedDid) ||
      !(flow.expectedHandle === null || typeof flow.expectedHandle === 'string')
    ) return null
    return flow as AdminOAuthFlowState
  } catch {
    return null
  }
}

function getEncryptionKey(): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(ADMIN_OAUTH_ENCRYPTION_KEY)) {
    throw new Error('ADMIN_OAUTH_ENCRYPTION_KEY must be exactly 64 hexadecimal characters.')
  }
  return Buffer.from(ADMIN_OAUTH_ENCRYPTION_KEY, 'hex')
}

function encryptState(value: NodeSavedState, stateHash: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  cipher.setAAD(Buffer.from(stateHash))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`
}

function decryptState(value: string, stateHash: string): NodeSavedState {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split('.')
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error('Stored OAuth state has an unsupported format.')
  }
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(encodedIv, 'base64url'))
  decipher.setAAD(Buffer.from(stateHash))
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
  return JSON.parse(plaintext) as NodeSavedState
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}
