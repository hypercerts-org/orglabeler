/**
 * Resolve the PDS endpoint for a handle.
 * Steps: handle → DID → PLC directory → extract #atproto_pds serviceEndpoint
 */
export async function resolvePds(handle: string): Promise<{ did: string; pds: string }> {
  // Step 1: Resolve handle to DID
  const handleRes = await fetch(
    `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
  )
  if (!handleRes.ok) throw new Error(`Failed to resolve handle: HTTP ${handleRes.status}`)
  const { did } = (await handleRes.json()) as { did: string }
  if (!did) throw new Error("No DID returned for handle")

  // Step 2: Look up DID document from PLC directory
  const plcRes = await fetch(`https://plc.directory/${did}`)
  if (!plcRes.ok) throw new Error(`Failed to fetch DID document: HTTP ${plcRes.status}`)
  const didDoc = (await plcRes.json()) as {
    service?: Array<{ id: string; type: string; serviceEndpoint: string }>
  }

  // Step 3: Extract PDS endpoint
  const pdsService = didDoc.service?.find(
    (s) => s.id === "#atproto_pds" || s.id.endsWith("#atproto_pds")
  )
  if (!pdsService?.serviceEndpoint) {
    throw new Error(`No #atproto_pds service found in DID document for ${did}`)
  }

  return { did, pds: pdsService.serviceEndpoint }
}
