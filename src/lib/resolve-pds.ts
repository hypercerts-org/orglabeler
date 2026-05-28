interface DidDocument {
  service?: Array<{ id: string; type?: string; serviceEndpoint?: unknown }>
}

function extractPdsEndpoint(did: string, didDoc: DidDocument): string {
  const pdsService = didDoc.service?.find(
    service => service.id === '#atproto_pds' || service.id.endsWith('#atproto_pds')
  )

  if (typeof pdsService?.serviceEndpoint !== 'string') {
    throw new Error(`No #atproto_pds service found in DID document for ${did}`)
  }

  return pdsService.serviceEndpoint
}

function didWebDocumentUrl(did: string): string {
  const methodSpecificId = did.slice('did:web:'.length)
  const parts = methodSpecificId.split(':').map(part => decodeURIComponent(part))
  const host = parts[0]
  if (!host) throw new Error(`Invalid did:web identifier: ${did}`)

  if (parts.length === 1) {
    return `https://${host}/.well-known/did.json`
  }

  return `https://${host}/${parts.slice(1).join('/')}/did.json`
}

async function fetchDidDocument(did: string): Promise<DidDocument> {
  let url: string
  if (did.startsWith('did:plc:')) {
    url = `https://plc.directory/${did}`
  } else if (did.startsWith('did:web:')) {
    url = didWebDocumentUrl(did)
  } else {
    throw new Error(`Unsupported DID method for PDS resolution: ${did}`)
  }

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch DID document for ${did}: HTTP ${res.status}`)
  }

  return (await res.json()) as DidDocument
}

/** Resolves the actor PDS endpoint from a DID document. */
export async function resolvePdsForDid(did: string): Promise<{ did: string; pds: string }> {
  const didDoc = await fetchDidDocument(did)
  return { did, pds: extractPdsEndpoint(did, didDoc) }
}

/**
 * Resolve the PDS endpoint for a handle.
 * Steps: handle → DID → DID document → extract #atproto_pds serviceEndpoint.
 */
export async function resolvePds(handle: string): Promise<{ did: string; pds: string }> {
  const handleRes = await fetch(
    `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
  )
  if (!handleRes.ok) throw new Error(`Failed to resolve handle: HTTP ${handleRes.status}`)
  const { did } = (await handleRes.json()) as { did: string }
  if (!did) throw new Error('No DID returned for handle')

  return resolvePdsForDid(did)
}
