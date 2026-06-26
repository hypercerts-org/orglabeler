// Run with: npx tsx src/labeler/set-labels.ts [labeler-identifier] [password]

import { LABELER_IDENTIFIER, LABELER_PASSWORD } from '../lib/config'
import { LABELS } from '../lib/constants'
import { resolvePds } from '../lib/resolve-pds'
import { setLabelerLabelDefinitions } from './declare-labeler'

async function main() {
  const identifier = process.argv[2] || LABELER_IDENTIFIER
  const password = process.argv[3] || LABELER_PASSWORD

  if (!identifier || !password) {
    console.error('Error: LABELER_IDENTIFIER and LABELER_PASSWORD must be set in .env or passed as CLI args')
    console.error('Usage: npx tsx src/labeler/set-labels.ts <labeler-identifier> <password>')
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
