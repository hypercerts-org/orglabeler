import { LabelerServer } from '@skyware/labeler'
import { DID, SIGNING_KEY, LABELS_DB_PATH } from '../lib/config'
import { QUALITY_LABEL_IDENTIFIERS } from '../lib/constants'
import logger from './logger'

export const labelerServer = new LabelerServer({ did: DID, signingKey: SIGNING_KEY, dbPath: LABELS_DB_PATH })

export async function fetchCurrentLabels(did: string): Promise<Set<string>> {
  await labelerServer.db.execute('SELECT 1') // ensure db is ready
  const result = await labelerServer.db.execute({
    sql: 'SELECT val, neg FROM labels WHERE uri = ?',
    args: [did],
  })

  const active = new Set<string>()
  for (const row of result.rows) {
    const val = row['val'] as string
    const neg = row['neg']
    if (neg) {
      active.delete(val)
    } else {
      active.add(val)
    }
  }
  return active
}

export async function applyQualityLabel(did: string, labelIdentifier: string): Promise<void> {
  // 1. Fetch current labels for the DID
  const currentLabels = await fetchCurrentLabels(did)

  // 2. Filter to only QUALITY_LABEL_IDENTIFIERS
  const currentQualityLabels = [...currentLabels].filter(l => QUALITY_LABEL_IDENTIFIERS.includes(l))

  // 3. If DID already has the same quality label → return (no change needed)
  if (currentQualityLabels.includes(labelIdentifier)) {
    logger.info({ did, label: labelIdentifier }, 'DID already has label, skipping')
    return
  }

  // 4. If DID has a different quality label → negate it first
  if (currentQualityLabels.length > 0) {
    logger.info({ did, negating: currentQualityLabels }, 'Negating existing quality labels')
    await labelerServer.createLabels({ uri: did }, { negate: currentQualityLabels })
  }

  // 5. Create the new label
  logger.info({ did, label: labelIdentifier }, 'Applying quality label')
  await labelerServer.createLabel({ uri: did, val: labelIdentifier })
}
