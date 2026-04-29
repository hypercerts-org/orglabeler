import '@atcute/bluesky'
import { Client, CredentialManager } from '@atcute/client'
import { ORGANIZATION_COLLECTION, PROFILE_COLLECTION } from '../lib/config'

export interface LoginCredentials {
  pds?: string
  identifier: string
  password: string
  code?: string
}

export interface LabelValueDefinition {
  identifier: string
  [key: string]: unknown
}

export interface DeclareLabelerOptions {
  subjectTypes?: string[]
  subjectCollections?: string[]
  reasonTypes?: string[]
}

const DEFAULT_DECLARE_OPTIONS: Required<Pick<DeclareLabelerOptions, 'subjectTypes' | 'subjectCollections'>> = {
  subjectTypes: ['record'],
  subjectCollections: [PROFILE_COLLECTION, ORGANIZATION_COLLECTION],
}

const DEFAULT_PDS = 'https://bsky.social'

type CachedLoginAgent = {
  credentialManager: CredentialManager
  xrpc: Client
}

const loginAgentCache = new Map<string, CachedLoginAgent>()

type XrpcAgent = {
  get: (name: string, options?: unknown) => Promise<{ data?: { value?: unknown } }>
  post: (name: string, options?: unknown) => Promise<XrpcPostResponse>
}

type XrpcPostResponse = {
  ok: boolean
  status: number
  data?: {
    error?: string
    message?: string
  }
}

async function loginAgent({ pds, ...credentials }: LoginCredentials) {
  const normalizedPds = normalizeLoginPds(pds)
  const { credentialManager, xrpc } = getCachedLoginAgent(normalizedPds)

  if (credentialManager.session && credentialsMatchSession({ pds, ...credentials }, credentialManager.session)) {
    return { agent: xrpc as unknown as XrpcAgent, session: credentialManager.session }
  }

  const session = await credentialManager.login(credentials)
  return { agent: xrpc as unknown as XrpcAgent, session }
}

function getCachedLoginAgent(normalizedPds: string) {
  const cachedLoginAgent = loginAgentCache.get(normalizedPds)
  if (cachedLoginAgent) return cachedLoginAgent

  const credentialManager = new CredentialManager({ service: normalizedPds })
  const xrpc = new Client({ handler: credentialManager })
  const loginAgent = { credentialManager, xrpc }

  loginAgentCache.set(normalizedPds, loginAgent)
  return loginAgent
}

function normalizePds(pds: string) {
  return pds.replace(/\/+$/, '')
}

function normalizeLoginPds(pds?: string) {
  return normalizePds(pds || DEFAULT_PDS)
}

function credentialsMatchSession(
  credentials: LoginCredentials,
  session: { did: string; handle: string; email?: string | null; pdsUri?: string },
) {
  const pdsMatches = credentials.pds === undefined
    ? true
    : !!session.pdsUri && normalizeLoginPds(credentials.pds) === normalizePds(session.pdsUri)

  return pdsMatches
    && [session.did, session.handle, session.email].includes(credentials.identifier)
}

function buildDeclarationRecord(
  labelDefinitions: LabelValueDefinition[],
  options?: DeclareLabelerOptions,
) {
  const labelValues = labelDefinitions.map(({ identifier }) => identifier)
  const mergedOptions = {
    ...DEFAULT_DECLARE_OPTIONS,
    ...options,
  }

  return {
    $type: 'app.bsky.labeler.service',
    policies: {
      labelValues,
      labelValueDefinitions: labelDefinitions,
    },
    createdAt: new Date().toISOString(),
    ...(mergedOptions.reasonTypes ? { reasonTypes: mergedOptions.reasonTypes } : {}),
    ...(mergedOptions.subjectTypes ? { subjectTypes: mergedOptions.subjectTypes } : {}),
    ...(mergedOptions.subjectCollections ? { subjectCollections: mergedOptions.subjectCollections } : {}),
  }
}

function assertPostSucceeded(endpoint: string, response: XrpcPostResponse) {
  if (response.ok) return

  const details = [response.data?.error, response.data?.message].filter(Boolean).join(': ')
  throw new Error(`XRPC post failed for ${endpoint} with status ${response.status}${details ? `: ${details}` : ''}`)
}

export async function getLabelerDeclaration(credentials: LoginCredentials): Promise<Record<string, unknown> | null> {
  const { agent, session } = await loginAgent(credentials)

  const { data } = await agent.get('com.atproto.repo.getRecord', {
    params: { collection: 'app.bsky.labeler.service', rkey: 'self', repo: session.did },
  }).catch(() => ({ data: { value: null } }))

  return (data?.value as Record<string, unknown> | null) ?? null
}

export async function getLabelerLabelDefinitions(credentials: LoginCredentials): Promise<LabelValueDefinition[] | null> {
  const declaration = await getLabelerDeclaration(credentials)
  return (declaration?.policies as { labelValueDefinitions?: LabelValueDefinition[] } | undefined)?.labelValueDefinitions ?? null
}

export async function declareLabeler(
  credentials: LoginCredentials,
  labelDefinitions: LabelValueDefinition[],
  overwriteExisting?: boolean,
  options?: DeclareLabelerOptions,
): Promise<void> {
  const { agent, session } = await loginAgent(credentials)
  const existing = await getLabelerDeclaration(credentials)

  if (existing && !overwriteExisting) {
    if (overwriteExisting === false) return
    throw new Error('Label definitions already exist. Use `overwriteExisting: true` to update them, or `overwriteExisting: false` to silence this error.')
  }

  const data = {
    collection: 'app.bsky.labeler.service',
    rkey: 'self',
    repo: session.did,
    record: buildDeclarationRecord(labelDefinitions, options),
    validate: true,
  }

  if (existing) {
    const response = await agent.post('com.atproto.repo.putRecord', { input: data })
    assertPostSucceeded('com.atproto.repo.putRecord', response)
  } else {
    const response = await agent.post('com.atproto.repo.createRecord', { input: data })
    assertPostSucceeded('com.atproto.repo.createRecord', response)
  }
}

export async function setLabelerLabelDefinitions(
  credentials: LoginCredentials,
  labelDefinitions: LabelValueDefinition[],
  options?: DeclareLabelerOptions,
): Promise<void> {
  return declareLabeler(credentials, labelDefinitions, true, options)
}
