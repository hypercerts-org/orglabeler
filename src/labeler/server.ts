import { LabelerServer } from '@skyware/labeler'
import { DID, SIGNING_KEY, LABELS_DB_PATH } from '../lib/config'
import { QUALITY_LABEL_IDENTIFIERS } from '../lib/constants'
import logger from './logger'

export const labelerServer = new LabelerServer({ did: DID, signingKey: SIGNING_KEY, dbPath: LABELS_DB_PATH })

export async function fetchCurrentLabels(uri: string): Promise<Set<string>> {
  await labelerServer.db.execute('SELECT 1') // ensure db is ready
  const result = await labelerServer.db.execute({
    sql: 'SELECT val, neg FROM labels WHERE uri = ? ORDER BY id ASC',
    args: [uri],
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

export async function negateAllDIDLabels(): Promise<number> {
  await labelerServer.db.execute('SELECT 1') // ensure db is ready
  const result = await labelerServer.db.execute({
    sql: 'SELECT DISTINCT uri FROM labels WHERE uri LIKE \'did:%\'',
    args: [],
  })

  let negatedCount = 0
  for (const row of result.rows) {
    const did = row['uri'] as string
    try {
      const activeLabels = await fetchCurrentLabels(did)
      const activeQualityLabels = [...activeLabels].filter(l => QUALITY_LABEL_IDENTIFIERS.includes(l))
      if (activeQualityLabels.length > 0) {
        logger.info({ did, negating: activeQualityLabels }, 'Negating stale DID-level quality labels')
        await labelerServer.createLabels({ uri: did }, { negate: activeQualityLabels })
        negatedCount++
      }
    } catch (err) {
      logger.error({ err, did }, 'Failed to negate DID-level labels, continuing')
    }
  }
  return negatedCount
}

export async function negateQualityLabels(recordUri: string): Promise<number> {
  const existing = uriLocks.get(recordUri)
  const operation = (existing ?? Promise.resolve()).then(async () => {
    await labelerServer.db.execute('SELECT 1') // ensure db is ready
    const currentLabels = await fetchCurrentLabels(recordUri)
    const activeQualityLabels = [...currentLabels].filter(l => QUALITY_LABEL_IDENTIFIERS.includes(l))

    if (activeQualityLabels.length === 0) {
      return 0
    }

    logger.info({ uri: recordUri, negating: activeQualityLabels }, 'Negating quality labels for deleted record')
    await labelerServer.createLabels({ uri: recordUri }, { negate: activeQualityLabels })
    return activeQualityLabels.length
  }).finally(() => {
    if (uriLocks.get(recordUri) === operation) {
      uriLocks.delete(recordUri)
    }
  })

  uriLocks.set(recordUri, operation)
  return operation as Promise<number>
}

const uriLocks = new Map<string, Promise<unknown>>()

export async function applyQualityLabel(recordUri: string, labelIdentifier: string): Promise<void> {
  // Validate labelIdentifier before any DB operations
  if (!QUALITY_LABEL_IDENTIFIERS.includes(labelIdentifier)) {
    logger.error({ uri: recordUri, label: labelIdentifier }, 'Rejected unknown label identifier')
    return
  }

  // Wait for any in-flight operation on this URI
  const existing = uriLocks.get(recordUri)
  const operation = (existing ?? Promise.resolve()).then(async () => {
    // 1. Fetch current labels for the record URI
    const currentLabels = await fetchCurrentLabels(recordUri)

    // 2. Filter to only QUALITY_LABEL_IDENTIFIERS
    const currentQualityLabels = [...currentLabels].filter(l => QUALITY_LABEL_IDENTIFIERS.includes(l))

    // 3. If record already has the same quality label → return (no change needed)
    if (currentQualityLabels.includes(labelIdentifier)) {
      logger.info({ uri: recordUri, label: labelIdentifier }, 'Record already has label, skipping')
      return
    }

    // 4. If record has a different quality label → negate it first
    if (currentQualityLabels.length > 0) {
      logger.info({ uri: recordUri, negating: currentQualityLabels }, 'Negating existing quality labels')
      await labelerServer.createLabels({ uri: recordUri }, { negate: currentQualityLabels })
    }

    // 5. Create the new label
    logger.info({ uri: recordUri, label: labelIdentifier }, 'Applying quality label')
    await labelerServer.createLabel({ uri: recordUri, val: labelIdentifier })
  }).finally(() => {
    // Clean up lock if we're still the latest
    if (uriLocks.get(recordUri) === operation) {
      uriLocks.delete(recordUri)
    }
  })
  uriLocks.set(recordUri, operation)
  return operation as Promise<void>
}
