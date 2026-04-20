import type { MergedActorInput, MergedActorOutput } from './types'
import { buildMergedScoringInput } from './scoring-input'

function websiteHostname(website: string | undefined | null): string | null {
  if (!website?.trim()) return null

  try {
    return new URL(website).hostname
  } catch {
    return null
  }
}

export function getMergedActorDisplay(actor: MergedActorInput): MergedActorOutput {
  const merged = buildMergedScoringInput(actor)

  return {
    did: actor.did,
    profile: actor.profile,
    organization: actor.organization,
    displayName: merged.displayName,
    hasProfileDescription: Boolean(merged.profileDescription),
    hasWebsite: Boolean(merged.profileWebsite),
    hasAvatar: merged.hasAvatar,
    websiteHostname: websiteHostname(merged.profileWebsite),
  }
}
