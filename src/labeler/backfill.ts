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
          uri did rkey
          title shortDescription description
          workScope startDate endDate rights createdAt
          locations
          image {
            ... on OrgHypercertsDefsUri { uri }
            ... on OrgHypercertsDefsSmallImage { image { mimeType ref size } }
          }
          contributors {
            contributorIdentity contributionWeight contributionDetails
          }
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
  title?: string | null
  shortDescription?: string | null
  description?: string
  workScope?: string
  startDate?: string
  endDate?: string
  rights?: { uri: string; cid: string }
  createdAt: string
  image?: { uri: string } | { image: { mimeType: string; ref: string; size: number } } | null
  contributors?: Array<{ contributorIdentity: unknown; contributionWeight?: string; contributionDetails?: unknown }> | null
  locations?: unknown[] | null
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

async function fetchPage(after?: string, pageSize: number = PAGE_SIZE): Promise<PageResult> {
  const variables: Record<string, unknown> = { first: pageSize }
  if (after) variables.after = after

  const body = JSON.stringify({ query: QUERY, variables })

  const res = await fetch(HYPERINDEX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

  const responseText = await res.text()

  if (!res.ok && !responseText.includes('"data"')) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}\n${responseText}`)
  }

  const json = JSON.parse(responseText) as { data?: { orgHypercertsClaimActivity: PageResult } | null; errors?: Array<{ message: string }> }

  if (json.errors && json.errors.length > 0) {
    // Log errors as warnings but continue if we have partial data
    for (const err of json.errors) {
      console.warn(`  GraphQL warning: ${err.message}`)
    }
    if (!json.data?.orgHypercertsClaimActivity) {
      throw new Error(json.errors[0].message)
    }
  }

  if (!json.data) {
    throw new Error('No data in response')
  }

  return json.data.orgHypercertsClaimActivity
}

// Fetch a page, using binary search to skip bad records with null non-nullable fields.
// When a page fails, we binary search for the largest first value that succeeds,
// collect those records, then continue from the endCursor (the API skips bad records
// when using cursor-based pagination).
async function fetchPageWithRetry(after?: string, totalCount?: number): Promise<PageResult> {
  try {
    return await fetchPage(after, PAGE_SIZE)
  } catch (err) {
    console.warn(`  Page fetch failed (${(err as Error).message}), binary searching for bad record`)

    const allEdges: PageEdge[] = []
    let cursor: string | undefined = after
    let lastTotalCount = totalCount ?? 0

    // Keep collecting records until we have PAGE_SIZE or reach end of data
    while (allEdges.length < PAGE_SIZE) {
      // Binary search: find largest first value that succeeds from current cursor
      let lo = 1
      let hi = PAGE_SIZE - allEdges.length
      let lastGood: PageResult | null = null

      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        try {
          const result = await fetchPage(cursor, mid)
          lastGood = result
          lastTotalCount = result.totalCount
          lo = mid + 1
        } catch {
          hi = mid - 1
        }
      }

      if (!lastGood || lastGood.edges.length === 0) {
        console.warn(`  Could not fetch any records from cursor ${cursor ?? 'start'}, stopping`)
        break
      }

      allEdges.push(...lastGood.edges)
      cursor = lastGood.pageInfo.endCursor ?? undefined

      if (!lastGood.pageInfo.hasNextPage || !cursor) {
        return { edges: allEdges, pageInfo: lastGood.pageInfo, totalCount: lastTotalCount }
      }

      // The next record after endCursor may be bad — the API will skip it automatically
      // when we use after=cursor. Try fetching the rest of the page.
      try {
        const rest = await fetchPage(cursor, PAGE_SIZE - allEdges.length)
        allEdges.push(...rest.edges)
        return { edges: allEdges, pageInfo: rest.pageInfo, totalCount: rest.totalCount }
      } catch {
        // Another bad record in the remaining records — loop again
        continue
      }
    }

    const lastEdge = allEdges[allEdges.length - 1]
    return {
      edges: allEdges,
      pageInfo: {
        hasNextPage: cursor !== undefined,
        endCursor: lastEdge?.cursor ?? cursor ?? null,
      },
      totalCount: lastTotalCount,
    }
  }
}

function toActivityRecord(node: PageNode): ActivityRecord {
  let image: ActivityRecord['image']
  if (node.image) {
    if ('uri' in node.image) {
      image = { uri: node.image.uri }
    } else if ('image' in node.image) {
      image = { file: node.image.image }
    }
  }

  return {
    title: node.title ?? '',
    shortDescription: node.shortDescription ?? '',
    description: node.description,
    createdAt: node.createdAt,
    startDate: node.startDate,
    endDate: node.endDate,
    workScope: node.workScope,
    rights: node.rights,
    image,
    contributors: node.contributors as ActivityRecord['contributors'] ?? undefined,
    locations: node.locations as ActivityRecord['locations'] ?? undefined,
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
    const page = await fetchPageWithRetry(cursor, totalCount)
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

    // Safety: stop if we've processed all known records
    if (totalCount > 0 && processed >= totalCount) {
      cursor = undefined
    }
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
