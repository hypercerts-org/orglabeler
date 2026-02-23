import { HfInference } from '@huggingface/inference'
import * as config from './config'
import { updateActivityHfFields, getActivityByDidRkey, getHfClassifiedNonFlagged } from './db'
import { tierForScore } from './scorer'
import { updateActivity } from './db'

export interface ContentClassification {
  label: string
  score: number
  allScores: Record<string, number>
}

const CANDIDATE_LABELS = [
  'meaningful project description',
  'test or placeholder data',
  'song lyrics or copypasta',
  'spam or gibberish',
]

const DELAY_MS = 2000 // 2s between calls to avoid rate limits

interface QueueItem {
  text: string
  did: string
  rkey: string
}

const queue: QueueItem[] = []
let processing = false

export function enqueueClassification(text: string, did: string, rkey: string): void {
  queue.push({ text, did, rkey })
  if (!processing) processQueue()
}

export function getQueueLength(): number {
  return queue.length
}

async function processQueue(): Promise<void> {
  processing = true
  let processed = 0
  let skipped = 0
  let failed = 0
  while (queue.length > 0) {
    const item = queue.shift()!
    try {
      const classification = await classifyContent(item.text, item.did, item.rkey)
      if (classification) {
        updateActivityHfFields(item.did, item.rkey, classification.label, classification.score)
        console.log('[hf]', `${item.did}/${item.rkey}`, classification.label, classification.score)
        processed++

        if (isLowQualityContent(classification)) {
          reclassifyWithHfSignal(item.did, item.rkey, classification)
        }
      } else {
        skipped++
      }
    } catch (err) {
      console.warn('[hf-classifier] queue item failed:', err instanceof Error ? err.message : err)
      failed++
    }
    // Wait between calls to avoid rate limiting
    if (queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS))
    }
  }
  console.log('[hf] queue complete:', processed, 'classified,', skipped, 'skipped,', failed, 'failed')
  processing = false
}

function reclassifyWithHfSignal(did: string, rkey: string, classification: ContentClassification): void {
  const row = getActivityByDidRkey(did, rkey)
  if (!row) return

  let existingSignals: string[] = []
  try {
    existingSignals = JSON.parse(row.testSignals) as string[]
  } catch {
    existingSignals = []
  }

  const label = classification.label
  const scorePct = (classification.score * 100).toFixed(0)
  const updatedSignals = [...existingSignals, `hf-flagged: ${label} (${scorePct}%)`]
  const newTier = tierForScore(row.score, updatedSignals)

  updateActivity(did, rkey, {
    score: row.score,
    tier: newTier,
    breakdown: row.breakdown,
    testSignals: JSON.stringify(updatedSignals),
  })
}

let hf: HfInference | null = null
let _noTokenLogged = false

function getHfInstance(): HfInference {
  if (!hf) {
    hf = new HfInference(config.HF_TOKEN)
  }
  return hf
}

async function classifyContent(text: string, did?: string, rkey?: string): Promise<ContentClassification | null> {
  if (!config.HF_TOKEN) {
    if (!_noTokenLogged) {
      console.log('[hf] HF_TOKEN not set — classification disabled')
      _noTokenLogged = true
    }
    return null
  }
  if (!text.trim()) {
    console.log('[hf] skip empty text:', did, rkey)
    return null
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const results = await getHfInstance().zeroShotClassification({
      model: config.HF_MODEL,
      inputs: text,
      parameters: { candidate_labels: CANDIDATE_LABELS },
    }, { signal: controller.signal })

    // results is ZeroShotClassificationOutput = ZeroShotClassificationOutputElement[]
    // sorted by score descending — first element is the winning label
    const allScores: Record<string, number> = {}
    for (const item of results) {
      allScores[item.label] = item.score
    }

    const winner = results[0]
    return {
      label: winner.label,
      score: winner.score,
      allScores,
    }
  } catch (err) {
    console.warn('[hf-classifier] classification failed:', err instanceof Error ? err.message : err)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export function isLowQualityContent(classification: ContentClassification): boolean {
  return classification.label !== 'meaningful project description'
}

// Re-evaluate existing HF classifications against current thresholds.
// Called on startup to catch records that were classified before a threshold change.
export function reevaluateExistingClassifications(): number {
  const candidates = getHfClassifiedNonFlagged()
  let reclassified = 0
  for (const { did, rkey, hfLabel, hfScore } of candidates) {
    const classification: ContentClassification = {
      label: hfLabel,
      score: hfScore,
      allScores: {},  // not needed for isLowQualityContent
    }
    if (isLowQualityContent(classification)) {
      reclassifyWithHfSignal(did, rkey, classification)
      reclassified++
    }
  }
  return reclassified
}
