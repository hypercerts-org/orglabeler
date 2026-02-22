import { HfInference } from '@huggingface/inference'
import * as config from './config'

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

let hf: HfInference | null = null

function getHfInstance(): HfInference {
  if (!hf) {
    hf = new HfInference(config.HF_TOKEN)
  }
  return hf
}

export async function classifyContent(text: string): Promise<ContentClassification | null> {
  if (!config.HF_TOKEN) {
    return null
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

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
  return classification.label !== 'meaningful project description' && classification.score > 0.6
}
