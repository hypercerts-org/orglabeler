import type { MergedActorInput, MergedActorOutput } from './types'

function firstNonEmpty(values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }

  return null
}

function shortDid(did: string): string {
  return did.replace(/^did:plc:/, '').slice(0, 12) + '…'
}

function websiteHostname(website: string | undefined | null): string | null {
  if (!website?.trim()) return null

  try {
    return new URL(website).hostname
  } catch {
    return null
  }
}

export function getMergedActorDisplay(actor: MergedActorInput): MergedActorOutput {
  const profileDisplayName = actor.profile?.displayName?.trim()
  const organizationType = firstNonEmpty(actor.organization?.organizationType ?? [])

  const displayName = profileDisplayName ?? organizationType ?? shortDid(actor.did)
  const hasProfileDescription = Boolean(actor.profile?.description?.trim())
  const hasWebsite = Boolean(actor.profile?.website?.trim())
  const hasAvatar = actor.profile?.avatar != null

  return {
    did: actor.did,
    profile: actor.profile,
    organization: actor.organization,
    displayName,
    hasProfileDescription,
    hasWebsite,
    hasAvatar,
    websiteHostname: websiteHostname(actor.profile?.website),
  }
}
