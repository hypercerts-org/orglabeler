// Run with: npx tsx src/labeler/set-labels.ts [handle] [password]

import { BSKY_IDENTIFIER, BSKY_PASSWORD } from '../lib/config'
import { LABELS } from '../lib/constants'
import { resolvePds } from '../lib/resolve-pds'
import { setLabelerLabelDefinitions } from './declare-labeler'

async function main() {
  const identifier = process.argv[2] || BSKY_IDENTIFIER
  const password = process.argv[3] || BSKY_PASSWORD

  if (!identifier || !password) {
    console.error('Error: BSKY_IDENTIFIER and BSKY_PASSWORD must be set in .env or passed as CLI args')
    console.error('Usage: npx tsx src/labeler/set-labels.ts <handle> <password>')
    process.exit(1)
  }

  console.log(`Resolving account for ${identifier}...`)
  const { did, pds } = await resolvePds(identifier)
  console.log(`Setting up labels for ${did} (${identifier}) on PDS ${pds}...`)

  const labelDefinitions = LABELS.map(label => ({
    identifier: label.identifier,
    severity: 'inform' as const,
    blurs: 'none' as const,
    defaultSetting: 'warn' as const,
    adultOnly: false,
    locales: label.locales,
  }))

  await setLabelerLabelDefinitions(
    { identifier, password, pds },
    labelDefinitions,
  )

  for (const label of LABELS) {
    console.log(`  ✓ ${label.identifier}: ${label.locales[0]?.name}`)
  }

  console.log('Done! All labels registered.')
}

main().catch(err => {
  console.error('Failed to set labels:', err)
  process.exit(1)
})
