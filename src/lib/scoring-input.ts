import type { Main as OrganizationRecord } from '../lexicons/app/certified/actor/organization.defs'
import type { Main as ProfileRecord } from '../lexicons/app/certified/actor/profile.defs'

export type MergedDisplayNameSource = 'profile' | 'did'

export interface MergedOrganizationUrlItem {
  url: string
  label: string | null
}

export interface MergedScoringInput {
  did: string
  displayName: string
  displayNameSource: MergedDisplayNameSource
  profileDisplayName: string | null
  profileDescription: string | null
  profileWebsite: string | null
  validationNotes: string[]
  hasAvatar: boolean
  hasBanner: boolean
  organizationType: string[]
  urls: MergedOrganizationUrlItem[]
  location: OrganizationRecord['location'] | null
  foundedDate: string | null
}

export interface MergedScoringInputSource {
  did: string
  profile: ProfileRecord | null
  organization: OrganizationRecord | null
  profileValidationNotes?: string[]
}

const ORGANIZATION_URLS_FOR_SCORING_LIMIT = 4

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function shortDid(did: string): string {
  return did.replace(/^did:plc:/, '').slice(0, 12) + '…'
}

function buildDisplayName(
  did: string,
  profileDisplayName: string | null,
): { displayName: string; displayNameSource: MergedDisplayNameSource } {
  if (profileDisplayName) {
    return { displayName: profileDisplayName, displayNameSource: 'profile' }
  }

  return { displayName: shortDid(did), displayNameSource: 'did' }
}

export function buildMergedScoringInput(source: MergedScoringInputSource): MergedScoringInput {
  const profileDisplayName = normalizeText(source.profile?.displayName) || null
  const profileDescription = normalizeText(source.profile?.description) || null
  const profileWebsite = normalizeText(source.profile?.website) || null
  const validationNotes = (source.profileValidationNotes ?? [])
    .map(normalizeText)
    .filter(note => note.length > 0)
  const organizationType = (source.organization?.organizationType ?? [])
    .map(normalizeText)
    .filter(value => value.length > 0)
  const urls = (source.organization?.urls ?? [])
    .map(item => ({
      url: normalizeText(item?.url),
      label: normalizeText(item?.label) || null,
    }))
    .filter(item => item.url.length > 0)
    .slice(0, ORGANIZATION_URLS_FOR_SCORING_LIMIT)

  const { displayName, displayNameSource } = buildDisplayName(
    source.did,
    profileDisplayName,
  )

  return {
    did: source.did,
    displayName,
    displayNameSource,
    profileDisplayName,
    profileDescription,
    profileWebsite,
    validationNotes,
    hasAvatar: source.profile?.avatar != null,
    hasBanner: source.profile?.banner != null,
    organizationType,
    urls,
    location: source.organization?.location ?? null,
    foundedDate: normalizeText(source.organization?.foundedDate) || null,
  }
}
