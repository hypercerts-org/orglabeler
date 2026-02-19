// Run with: npx tsx src/labeler/set-labels.ts

import { BSKY_IDENTIFIER, BSKY_PASSWORD, DID } from '../lib/config'
import { LABELS } from '../lib/constants'
import { setLabelerLabelDefinitions } from '@skyware/labeler/scripts'

async function main() {
  if (!BSKY_IDENTIFIER || !BSKY_PASSWORD) {
    console.error('Error: BSKY_IDENTIFIER and BSKY_PASSWORD must be set in .env')
    process.exit(1)
  }

  if (!DID) {
    console.error('Error: DID must be set in .env')
    process.exit(1)
  }

  console.log(`Setting up labels for ${DID}...`)
  console.log(`Using account: ${BSKY_IDENTIFIER}`)

  const labelDefinitions = LABELS.map(label => ({
    identifier: label.identifier,
    severity: 'inform' as const,
    blurs: 'none' as const,
    defaultSetting: 'warn' as const,
    adultOnly: false,
    locales: label.locales,
  }))

  await setLabelerLabelDefinitions(
    { identifier: BSKY_IDENTIFIER, password: BSKY_PASSWORD },
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
