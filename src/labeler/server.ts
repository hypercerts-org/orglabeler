import { LabelerServer } from '@skyware/labeler'
import { DID, SIGNING_KEY, LABELS_DB_PATH } from '../lib/config'
import { QUALITY_LABEL_IDENTIFIERS } from '../lib/constants'
import logger from './logger'

export const labelerServer = new LabelerServer({ did: DID, signingKey: SIGNING_KEY, dbPath: LABELS_DB_PATH })

/**
 * Returns the active labels for one AT Protocol label subject.
 * Subjects may be actor DIDs or record URIs; negated labels remove earlier
 * active values from the returned set.
 */
export async function fetchCurrentLabels(subjectUri: string): Promise<Set<string>> {
  await labelerServer.db.execute('SELECT 1') // ensure db is ready
  const result = await labelerServer.db.execute({
    sql: 'SELECT val, neg FROM labels WHERE uri = ? ORDER BY id ASC',
    args: [subjectUri],
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

/**
 * Negates active quality labels that still target record URIs.
 * Use during the DID-label migration so old record-level labels stop appearing
 * once actors are labeled directly by DID.
 */
export async function negateAllRecordQualityLabels(): Promise<number> {
  await labelerServer.db.execute('SELECT 1') // ensure db is ready
  const result = await labelerServer.db.execute({
    sql: 'SELECT DISTINCT uri FROM labels WHERE uri LIKE \'at://%\'',
    args: [],
  })

  let negatedCount = 0
  for (const row of result.rows) {
    const subjectUri = row['uri'] as string
    try {
      const activeLabels = await fetchCurrentLabels(subjectUri)
      const activeQualityLabels = [...activeLabels].filter(l => QUALITY_LABEL_IDENTIFIERS.includes(l))
      if (activeQualityLabels.length > 0) {
        logger.info({ uri: subjectUri, negating: activeQualityLabels }, 'Negating stale record-level quality labels')
        await labelerServer.createLabels({ uri: subjectUri }, { negate: activeQualityLabels })
        negatedCount++
      }
    } catch (err) {
      logger.error({ err, uri: subjectUri }, 'Failed to negate record-level labels, continuing')
    }
  }
  return negatedCount
}

/**
 * Negates all active quality labels on one label subject.
 * Use this for deleted actors, deleted records, and record-level cleanup during
 * the DID-label migration.
 */
export async function negateQualityLabels(subjectUri: string): Promise<number> {
  const existing = uriLocks.get(subjectUri)
  const operation = (existing ?? Promise.resolve()).then(async () => {
    await labelerServer.db.execute('SELECT 1') // ensure db is ready
    const currentLabels = await fetchCurrentLabels(subjectUri)
    const activeQualityLabels = [...currentLabels].filter(l => QUALITY_LABEL_IDENTIFIERS.includes(l))

    if (activeQualityLabels.length === 0) {
      return 0
    }

    logger.info({ uri: subjectUri, negating: activeQualityLabels }, 'Negating quality labels')
    await labelerServer.createLabels({ uri: subjectUri }, { negate: activeQualityLabels })
    return activeQualityLabels.length
  }).finally(() => {
    if (uriLocks.get(subjectUri) === operation) {
      uriLocks.delete(subjectUri)
    }
  })

  uriLocks.set(subjectUri, operation)
  return operation as Promise<number>
}

const uriLocks = new Map<string, Promise<unknown>>()

/**
 * Ensures one quality label is active on a label subject.
 * Existing quality labels on the same DID or record URI are negated before the
 * new value is written, so each subject has at most one active quality tier.
 */
export async function applyQualityLabel(subjectUri: string, labelIdentifier: string): Promise<void> {
  // Validate labelIdentifier before any DB operations
  if (!QUALITY_LABEL_IDENTIFIERS.includes(labelIdentifier)) {
    logger.error({ uri: subjectUri, label: labelIdentifier }, 'Rejected unknown label identifier')
    return
  }

  // Wait for any in-flight operation on this URI
  const existing = uriLocks.get(subjectUri)
  const operation = (existing ?? Promise.resolve()).then(async () => {
    // 1. Fetch current labels for the subject URI
    const currentLabels = await fetchCurrentLabels(subjectUri)

    // 2. Filter to only QUALITY_LABEL_IDENTIFIERS
    const currentQualityLabels = [...currentLabels].filter(l => QUALITY_LABEL_IDENTIFIERS.includes(l))

    // 3. If subject already has the same quality label → return (no change needed)
    if (currentQualityLabels.includes(labelIdentifier)) {
      logger.info({ uri: subjectUri, label: labelIdentifier }, 'Subject already has label, skipping')
      return
    }

    // 4. If subject has a different quality label → negate it first
    if (currentQualityLabels.length > 0) {
      logger.info({ uri: subjectUri, negating: currentQualityLabels }, 'Negating existing quality labels')
      await labelerServer.createLabels({ uri: subjectUri }, { negate: currentQualityLabels })
    }

    // 5. Create the new label
    logger.info({ uri: subjectUri, label: labelIdentifier }, 'Applying quality label')
    await labelerServer.createLabel({ uri: subjectUri, val: labelIdentifier })
  }).finally(() => {
    // Clean up lock if we're still the latest
    if (uriLocks.get(subjectUri) === operation) {
      uriLocks.delete(subjectUri)
    }
  })
  uriLocks.set(subjectUri, operation)
  return operation as Promise<void>
}
