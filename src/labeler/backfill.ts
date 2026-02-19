import 'dotenv/config'
import { scoreActivity } from '../lib/scorer'
import { logActivity } from '../lib/db'
import type { ActivityRecord } from '../lib/types'

const HYPERINDEX_URL = 'https://api.hi.gainforest.app/graphql'
const PAGE_SIZE = 100
const COLLECTION = 'org.hypercerts.claim.activity'

const QUERY = `
  query BackfillActivities($first: Int!, $after: String) {
    orgHypercertsClaimActivity(first: $first, after: $after) {
      edges {
        node {
          uri did rkey title shortDescription description
          workScope startDate endDate rights createdAt
        }
        cursor
      }
      pageInfo { hasNextPage endCursor }
      totalCount
    }
  }
`

interface PageNode {
  uri: string
  did: string
  rkey: string
  title: string
  shortDescription: string
  description?: string
  workScope?: string
  startDate?: string
  endDate?: string
  rights?: { uri: string; cid: string }
  createdAt: string
}

interface PageEdge {
  node: PageNode
  cursor: string
}

interface PageInfo {
  hasNextPage: boolean
  endCursor: string | null
}

interface PageResult {
  edges: PageEdge[]
  pageInfo: PageInfo
  totalCount: number
}

async function fetchPage(after?: string): Promise<PageResult> {
  const res = await fetch(HYPERINDEX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: QUERY,
      variables: { first: PAGE_SIZE, after },
    }),
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }

  const json = await res.json() as { data?: { orgHypercertsClaimActivity: PageResult }; errors?: Array<{ message: string }> }

  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors[0].message)
  }

  if (!json.data) {
    throw new Error('No data in response')
  }

  return json.data.orgHypercertsClaimActivity
}

function toActivityRecord(node: PageNode): ActivityRecord {
  return {
    title: node.title,
    shortDescription: node.shortDescription,
    description: node.description,
    createdAt: node.createdAt,
    startDate: node.startDate,
    endDate: node.endDate,
    workScope: node.workScope,
    rights: node.rights,
    // image, contributors, locations omitted from simplified query — scorer handles gracefully
    image: undefined,
    contributors: undefined,
    locations: undefined,
  }
}

async function main() {
  const applyLabels = process.argv.includes('--labels')

  let cursor: string | undefined
  let processed = 0
  let skipped = 0
  let totalCount = 0

  console.log('Starting backfill from Hyperindex...')
  console.log(`  API: ${HYPERINDEX_URL}`)
  console.log(`  Collection: ${COLLECTION}`)
  if (applyLabels) {
    console.log('  Label application: ENABLED (--labels flag)')
  } else {
    console.log('  Label application: DISABLED (use --labels to enable)')
  }
  console.log()

  do {
    const page = await fetchPage(cursor)
    totalCount = page.totalCount

    if (processed === 0) {
      console.log(`Found ${totalCount} total records. Fetching in pages of ${PAGE_SIZE}...\n`)
    }

    for (const edge of page.edges) {
      const node = edge.node

      // Parse URI for did and rkey (prefer node.did/node.rkey if available)
      let did = node.did
      let rkey = node.rkey

      if (!did || !rkey) {
        const uriMatch = node.uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/)
        if (!uriMatch) {
          console.warn(`  Skipping invalid URI: ${node.uri}`)
          skipped++
          continue
        }
        did = uriMatch[1]
        rkey = uriMatch[3]
      }

      const record = toActivityRecord(node)
      const result = scoreActivity(record)

      logActivity({
        did,
        rkey,
        uri: node.uri,
        title: record.title || 'Untitled',
        score: result.totalScore,
        tier: result.tier,
        breakdown: JSON.stringify(result.breakdown),
        testSignals: JSON.stringify(result.testSignals),
        labeledAt: record.createdAt || new Date().toISOString(),
      })

      if (applyLabels) {
        try {
          const { applyQualityLabel } = await import('./server')
          await applyQualityLabel(did, result.tier)
        } catch (err) {
          console.warn(`  Label error for ${did}: ${err}`)
        }
      }

      processed++
      if (processed % 10 === 0 || processed === totalCount) {
        const title = (record.title ?? 'Untitled').substring(0, 40)
        console.log(`  [${processed}/${totalCount}] ${title.padEnd(40)} → ${result.tier} (${result.totalScore}/100)`)
      }
    }

    cursor = page.pageInfo.hasNextPage && page.pageInfo.endCursor
      ? page.pageInfo.endCursor
      : undefined
  } while (cursor)

  console.log(`\nBackfill complete:`)
  console.log(`  Processed: ${processed}`)
  if (skipped > 0) console.log(`  Skipped:   ${skipped}`)
  console.log(`  Total:     ${totalCount}`)
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
