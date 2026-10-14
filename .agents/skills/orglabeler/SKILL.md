---
name: orglabeler
description: Use this skill when integrating, querying, subscribing to, caching, troubleshooting, or interpreting Certified Organization Labeler / OrgLabeler labels for app.certified.actor.profile and app.certified.actor.organization actors. Trigger when a downstream product needs to consume OrgLabeler via com.atproto.label.queryLabels, com.atproto.label.subscribeLabels, dashboard REST endpoints, or needs to understand OrgLabeler-specific likely-test/standard/high-quality labels. Use this for product integrations that want to filter certified actor organizations, hide test data, show current OrgLabeler tiers, or debug why an actor received a tier.
---

# OrgLabeler Consumer

## Purpose

Help downstream applications consume Certified Organization Labeler signals correctly.

OrgLabeler watches certified actor records:

- `app.certified.actor.profile`
- `app.certified.actor.organization`

It assesses profile and organization context together by actor DID with Jev, then publishes a quality-tier label against the **actor DID** when the result is sufficiently confident.

These instructions are only for OrgLabeler labels from the OrgLabeler source. Do not generalize `likely-test`, `standard`, or `high-quality` to labels from other labelers.

## Public endpoint

Use this public endpoint unless the user provides another deployment:

```txt
https://orglabeler.hypercerts.dev
```

## Labeler account and source

Default OrgLabeler source account:

- Handle: `orglabeler.certified.one`
- DID/source: `did:plc:pswneepkd5lesumj7ejmkbal`
- Labeler service record: [`at://did:plc:pswneepkd5lesumj7ejmkbal/app.bsky.labeler.service/self`](https://pds.ls/at://did:plc:pswneepkd5lesumj7ejmkbal/app.bsky.labeler.service/self)

Use this DID as the label `src` when filtering OrgLabeler labels from a shared or multi-labeler source.

If the user provides a different deployment, ask for or derive:

- labeler endpoint URL
- labeler source DID and handle
- actor DID or handle being queried
- whether they need snapshot queries, live updates, or dashboard/debug data

When querying the OrgLabeler endpoint directly, the returned label `src` should identify the labeler source. When consuming labels through another service or aggregator, filter by the OrgLabeler source DID.

## Label values

OrgLabeler publishes these label values:

```txt
likely-test
standard
high-quality
```

Interpretation:

- `likely-test`: configured test-PDS policy matched or Jev found sufficiently strong contextual test-data evidence.
- `standard`: Jev found a substantive, coherent organization context with standard-level quality confidence.
- `high-quality`: Jev found a specific, coherent organization context with high-quality confidence.

Important:

- `likely-test` is not a general low-quality bucket.
- Incomplete real records are not automatically `likely-test`; if evidence is ambiguous or below confidence thresholds, the result can remain uncertain with no new label.
- Missing labels mean `unknown` or `not labeled yet`, not `standard`.
- Labels target actor DIDs, not individual `app.certified.actor.profile` or `app.certified.actor.organization` record URIs.
- The signed AT Protocol label carries only the tier. The dashboard API exposes assessment status, label freshness, model/question/policy versions, probabilities, and validation notes; those details are not part of the signed label.

## Choose the right integration path

### Use XRPC labels for product-facing integration

Use the standard AT Protocol label endpoints when a product needs current label state:

- `GET /xrpc/com.atproto.label.queryLabels` for snapshot lookup
- `GET /xrpc/com.atproto.label.subscribeLabels` for live WebSocket updates

This is the right path for apps that want to filter certified actors, hide test data, cache current tiers, or react to label changes.

### Use dashboard APIs for debugging and operator views

Use dashboard REST APIs for browsing and diagnostics:

- `GET /api/stats`
- `GET /api/recent?limit=20&offset=0`
- `GET /api/recent?limit=20&offset=0&tier=high-quality`
- `GET /api/recent?q=<did-or-name>`

Dashboard APIs expose current assessment status and probabilities for diagnostics. Treat uncertain, awaiting-configuration, awaiting-PDS-resolution, and stale-label states as distinct from the signed active tier. Use dashboard details to explain a label, not as the primary signed label stream if the product can consume XRPC labels directly.

## Query current labels

Use `com.atproto.label.queryLabels`.

Safe curl for one actor DID:

```bash
curl -G "https://orglabeler.hypercerts.dev/xrpc/com.atproto.label.queryLabels" \
  --data-urlencode "uriPatterns=did:plc:exampleactor" \
  --data-urlencode "limit=50"
```

For all labels, usually only for diagnostics or backfills:

```bash
curl -G "https://orglabeler.hypercerts.dev/xrpc/com.atproto.label.queryLabels" \
  --data-urlencode "uriPatterns=*" \
  --data-urlencode "limit=250"
```

For pagination, pass the returned `cursor` back as `cursor`.

Expected response shape from the current Skyware labeler implementation:

```json
{
  "cursor": "123",
  "labels": [
    {
      "id": 123,
      "ver": 1,
      "src": "did:plc:<orglabeler-source>",
      "uri": "did:plc:<actor-subject>",
      "val": "high-quality",
      "neg": false,
      "cts": "2026-01-01T00:00:00.000Z",
      "sig": {
        "$bytes": "base64-signature"
      }
    }
  ]
}
```

Field notes:

- `src`: DID of the labeler that produced the label.
- `uri`: actor DID that the label applies to.
- `val`: OrgLabeler tier value, one of `likely-test`, `standard`, or `high-quality`.
- `neg`: when true, this event removes a previous active label value.
- `cts`: label creation timestamp.
- `sig`: signed label proof, encoded as `{ "$bytes": "..." }` in JSON.
- `cursor`: pagination cursor for later `queryLabels` calls.
- `id`: currently returned by the Skyware labeler implementation, but not part of the standard label schema. Do not build product logic around it.

## Subscribe to live label updates

Use `com.atproto.label.subscribeLabels` when the product needs live updates.

The transport is a WebSocket carrying CBOR-framed AT Protocol subscription messages. Documentation examples can show the decoded shape, but do not imply the wire format is raw JSON.

Decoded event shape:

```json
{
  "seq": 123,
  "labels": [
    {
      "ver": 1,
      "src": "did:plc:<orglabeler-source>",
      "uri": "did:plc:<actor-subject>",
      "val": "standard",
      "neg": false,
      "cts": "2026-01-01T00:00:00.000Z",
      "sig": {
        "$bytes": "base64-signature"
      }
    }
  ]
}
```

Subscription notes:

- `seq` is the stream sequence for the emitted label event.
- If the client supports cursors, persist the latest processed `seq` and reconnect with it after downtime.
- Handle decoded info/error frames such as outdated/future cursor responses according to the client library being used.
- Process `neg: true` as state removal, not as a normal active tier.

## Derive the current active tier

If using `/api/recent`, the API already returns the current dashboard tier and no label-event state derivation is needed.

If using XRPC labels directly, treat labels as an event/history stream. Consumers do **not** create, modify, or apply labels to OrgLabeler. They only derive current state from label additions and removals returned by the labeler.

For each actor DID:

1. Read OrgLabeler label events for that DID.
2. Ignore labels whose `val` is not one of:
   - `likely-test`
   - `standard`
   - `high-quality`
3. For `neg: true`, remove that label value from the active set.
4. For missing or false `neg`, mark that label value active.
5. The current usable tier is the remaining active OrgLabeler tier.
6. If no active tier remains, treat it as `unknown`.

For a simple product that wants to filter out test data:

- include actors with active `standard`
- include actors with active `high-quality`
- exclude actors with active `likely-test`
- decide separately whether `unknown` actors should be included, hidden, or queued for recheck

Example TypeScript state derivation:

```ts
type OrgLabelerTier = 'likely-test' | 'standard' | 'high-quality'
type VisibleOrgLabelerTier = OrgLabelerTier | 'unknown'

type Label = {
  src: string
  uri: string
  val: string
  neg?: boolean
  cts: string
}

const ORG_LABELER_TIERS = new Set<OrgLabelerTier>([
  'likely-test',
  'standard',
  'high-quality',
])

function isOrgLabelerTier(value: string): value is OrgLabelerTier {
  return ORG_LABELER_TIERS.has(value as OrgLabelerTier)
}

function deriveOrgLabelerTier(labels: Label[]): VisibleOrgLabelerTier {
  const active = new Set<OrgLabelerTier>()

  for (const label of labels) {
    if (!isOrgLabelerTier(label.val)) continue

    if (label.neg) {
      active.delete(label.val)
    } else {
      active.add(label.val)
    }
  }

  if (active.has('likely-test')) return 'likely-test'
  if (active.has('high-quality')) return 'high-quality'
  if (active.has('standard')) return 'standard'

  return 'unknown'
}

function shouldShowCertifiedActor(tier: VisibleOrgLabelerTier): boolean {
  return tier === 'standard' || tier === 'high-quality'
}
```

If multiple tiers appear active because local state is stale or events were processed out of order, re-query the actor DID with `queryLabels` and rebuild state from the ordered response.

## Simple integration flow: filter test data from an existing app

Use this flow when an app displays certified actors and wants to hide test data:

1. Get the actor DID for each displayed account. Resolve handles to DIDs if needed.
2. Query OrgLabeler labels for those actor DIDs with `queryLabels`.
3. Derive each actor's current active OrgLabeler tier.
4. Show actors with `standard` or `high-quality`.
5. Hide actors with `likely-test`.
6. Decide product behavior for `unknown` actors.
7. Optionally use `/api/recent?q=<did>` in debug views to inspect the assessment status and current probabilities.

## Dashboard/debug API shapes

### `/api/stats`

Example response:

```json
{
  "stats": {
    "total": 100,
    "byTier": {
      "high-quality": 40,
      "standard": 50,
      "likely-test": 10
    },
    "byAssessmentStatus": {
      "queued": 2,
      "assessing": 1,
      "assessed": 80,
      "uncertain": 10,
      "awaiting-configuration": 5,
      "awaiting-pds-resolution": 1,
      "failed": 1,
      "legacy-stale": 0
    },
    "staleLabels": 4,
    "last24h": 5,
    "last7d": 30
  }
}
```

### `/api/recent`

Example request:

```bash
curl -G "https://orglabeler.hypercerts.dev/api/recent" \
  --data-urlencode "limit=20" \
  --data-urlencode "offset=0" \
  --data-urlencode "tier=high-quality"
```

Example response:

```json
{
  "activities": [
    {
      "did": "did:plc:<actor>",
      "rkey": "record-key",
      "uri": "at://did:plc:<actor>/app.certified.actor.organization/<rkey>",
      "displayName": "Example Org",
      "status": "assessed",
      "publishedTier": "high-quality",
      "labelStatus": "current",
      "model": "jev-latest",
      "questionVersion": "organization-assessment-questions-v1",
      "policyVersion": "provisional-confidence-policy-v1",
      "probabilities": {
        "test_data": { "type": "noul", "noul": 0.001 },
        "substantive_purpose": { "type": "noul", "noul": 0.99 },
        "consistency_quality": {
          "type": "choice",
          "choice": "high_quality",
          "confidence": 0.998,
          "probabilities": { "high_quality": 0.998, "standard": 0.001, "uncertain": 0.001 }
        }
      },
      "validationNotes": [],
      "updatedAt": "2026-01-01T00:00:00.000Z",
      "assessedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "total": 1
}
```

Supported `/api/recent` parameters:

- `limit`: clamped to 1-100.
- `offset`: pagination offset, minimum 0.
- `tier`: `all`, `likely-test`, `standard`, or `high-quality`; filters by published tier.
- `q`: search by display name, actor DID, or organization record URI.

## Troubleshooting

### No label returned

Check:

- Are you querying the actor DID, not the organization record URI?
- Are you using `https://orglabeler.hypercerts.dev` or the deployment the user intended?
- If consuming through an aggregator, are you filtering to the correct OrgLabeler source DID?
- Has the actor published `app.certified.actor.profile` and/or `app.certified.actor.organization` records?
- Could the labeler still be backfilling or waiting for ingestion?

### Record looks incomplete but is not `likely-test`

This is expected. `likely-test` comes from the configured test-PDS override or sufficiently strong contextual Jev evidence, not incompleteness alone. An incomplete or ambiguous non-test record can remain uncertain and unlabeled; `standard` is published only when Jev's confidence policy is satisfied.

### Need to know why something is `likely-test`

Use the dashboard/debug API:

```bash
curl -G "https://orglabeler.hypercerts.dev/api/recent" \
  --data-urlencode "q=did:plc:exampleactor"
```

Inspect `probabilities` when Jev ran; a configured test-PDS override bypasses Jev and may have no Jev probability payload. `validationNotes` describe record parsing/fallback and are not Jev explanations.

### Need assessment details

The signed AT Protocol label only carries the tier. Use `/api/recent` to inspect assessment status, label freshness, model/question/policy versions, and current probabilities. This is a content-quality assessment, not identity or legitimacy verification.

### Label changed unexpectedly

Labels can change after profile updates, organization record updates, URL evidence changes, PDS resolution, a forced reassessment, or backfill. Re-query `queryLabels` for the actor DID and rebuild active state.

## Do not do

Do not:

- treat these labels as applying to all `high-quality`, `standard`, or `likely-test` labels from any source
- query organization record URIs when the product needs actor labels
- treat `likely-test` as malicious activity
- treat `high-quality` as identity verification, endorsement, or proof of trust
- treat missing labels as `standard`
- ignore `neg: true` label events when consuming XRPC label streams/history
- read OrgLabeler SQLite databases directly from a downstream product
- mutate OrgLabeler, PDS, or AT Protocol state unless the user explicitly asks for operator/admin work

## Final answer pattern

When answering an OrgLabeler consumer integration question, include:

1. Which integration path to use: `queryLabels`, `subscribeLabels`, or dashboard REST API.
2. Exact endpoint or client call shape.
3. Expected response fields relevant to the user's use case.
4. How to derive or read the current tier.
5. Any caveats about actor DIDs, missing labels, `neg`, or debug APIs.
