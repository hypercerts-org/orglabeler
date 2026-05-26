# Tap Worker Plan

## Goal

Keep Tap ingestion fast and reliable by making the Tap handler do only cheap, durable local work. Anything that can block — URL checks, HuggingFace classification, label application retries, expensive recomputes — should run after Tap has been acknowledged.

## Problem

Tap only receives an ack after the event handler returns. When the handler performs network work, one slow URL or classifier request can hold the ack path long enough for Tap to retry events and grow the outbox buffer.

Confirmed example: website resolution inside `scoreActivity()` blocked Tap acks. Removing network URL checks let the outbox drain.

## Target flow

```txt
Tap event
  ↓
Fast handler
  - validate collection/action
  - persist latest profile/org snapshot
  - enqueue debounced recompute job for the DID
  - return so Tap can ack
  ↓
Debounced recompute worker
  - wait a short window so profile/org events can land together
  - recompute from best-known local state
  - apply/update a provisional label immediately
  - update dashboard DB
  ↓
Enrichment workers
  - resolve URLs with cache + timeout
  - classify with HuggingFace/BERT
  - enqueue recompute after results land
  - relabel only if the effective tier changes
```

## Rules

1. **No network I/O in the Tap handler**
   - no URL fetches
   - no HuggingFace calls
   - no remote label reads/writes if avoidable

2. **Tap handler must persist before returning**
   - write snapshots/job rows to SQLite
   - after that, the event can be safely acked

3. **Jobs must be durable and coalesced**
   - if profile and org events arrive close together, they should update one recompute job for the DID
   - workers should process the latest state, not every intermediate event

4. **Apply best-known labels immediately**
   - do not wait for URL or HF enrichment before applying a label
   - dashboard can show `pending enrichment`, but public labels should use the current best-known score
   - later enrichment can trigger a recompute and relabel if the tier changes

5. **Debounce actor recomputes briefly**
   - profile and organization events for the same DID often arrive close together
   - upsert one recompute job per DID with `run_after = now + 1–3 seconds`
   - repeated events update the same job instead of producing multiple labels

## Scoring model

Scoring should be pure and local-only. It can read snapshots and cached enrichment rows, but it must never perform network I/O.

Initial labels are **best-known provisional labels**. They are applied before URL checks or HuggingFace/BERT classification finish.

### URL scoring before enrichment

URL fields should be optimistic while enrichment is pending:

| URL state | Scoring behavior |
| --- | --- |
| Missing URL | `0` URL points |
| Invalid URL syntax | `0` URL points |
| Valid-looking URL, not checked yet | award provisional URL points |
| Resolved OK later | keep/confirm URL points |
| Temporary check failure | keep provisional/unknown state and retry |
| Repeated hard failure | remove resolve points and enqueue recompute |

This avoids delaying the first public label on slow or flaky URL checks. URL enrichment can still downgrade later if a URL repeatedly fails.

### HF/BERT scoring before enrichment

Classifier results should be conservative while pending:

| HF/BERT state | Scoring behavior |
| --- | --- |
| Missing or pending result | no effect |
| Failed or timed out | no effect, retry later |
| Positive/meaningful result | no effect or small confirmation only |
| Low-quality result with high confidence | add penalty, authenticity signal, or tier cap |

HF/BERT should not give optimistic points while pending. It should mainly act as a high-confidence negative signal because classifier false positives can otherwise cause label churn.

### Recompute and relabel rule

Any enrichment result writes to its cache table and then enqueues `recompute-org:{did}`. The recompute worker:

1. reads latest profile/org snapshots,
2. reads cached URL and HF/BERT results,
3. computes the current best-known tier,
4. updates the dashboard row every time, and
5. writes public ATProto labels only when the effective tier changes.

## Lightweight data model

### `recompute_jobs`

Actor-level work queue for scoring and label updates. `run_after` provides the short debounce window for profile/org events.

```sql
id INTEGER PRIMARY KEY,
kind TEXT NOT NULL,          -- recompute-org
key TEXT NOT NULL,           -- DID or DID+rkey
status TEXT NOT NULL,        -- pending, running, done, failed
attempts INTEGER NOT NULL,
run_after TEXT NOT NULL,
payload TEXT,
last_error TEXT,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
UNIQUE(kind, key)
```

### `url_checks`

Cache URL resolution so the same URL is not fetched on every record update.

```sql
normalized_url TEXT PRIMARY KEY,
status TEXT NOT NULL,        -- pending, ok, failed
resolvable INTEGER,
status_code INTEGER,
error TEXT,
checked_at TEXT,
expires_at TEXT
```

### `hf_classifications`

Stores classifier results keyed by model and input hash.

```sql
did TEXT NOT NULL,
rkey TEXT NOT NULL,
model TEXT NOT NULL,
input_hash TEXT NOT NULL,
status TEXT NOT NULL,        -- pending, done, failed
label TEXT,
score REAL,
error TEXT,
classified_at TEXT,
PRIMARY KEY (did, rkey, model, input_hash)
```

## Rollout phases

### Phase 0 — current emergency fix

- Keep URL network checks out of `scoreActivity()`.
- Keep org URL scoring bounded.
- Confirm Tap outbox drains after deploy.

### Phase 1 — durable recompute worker

Status: implemented.

- `src/lib/db.ts` creates and manages `recompute_jobs` in the dashboard SQLite database.
- Tap handlers persist profile/org snapshots or pending delete rows, upsert one `recompute-org` job per DID, then return without scoring, HuggingFace calls, or label writes.
- Jobs use a 2 second debounce window so profile/org events can coalesce.
- `startRecomputeWorker()` drains due jobs, recomputes from best-known local state, writes dashboard rows, applies labels, and refreshes HuggingFace classification outside the Tap ack path.
- Organization deletes are persisted in `pending_organization_deletes` and negated/cleaned up by the worker or startup reconciliation.
- `/metrics` exposes `orglabeler_recompute_jobs{status="..."}` for queue depth by status and `orglabeler_tap_handler_duration_ms` for Tap handler latency.

### Phase 2 — URL enrichment worker

- Add `url_checks` cache.
- Worker resolves URLs with low concurrency and short timeouts.
- Recompute org score after URL results land.
- Relabel only if the effective tier changes.
- Never block Tap ack on URL results.

### Phase 3 — HuggingFace/BERT worker

- Add `hf_classifications`.
- Hash classifier input so unchanged text reuses the same result.
- Process with low concurrency and retries/backoff.
- Recompute labels after classification lands.
- Relabel only if the effective tier changes.

### Phase 4 — cleanup and observability

- Show enrichment status in dashboard.
- Add dead-letter view for failed jobs.
- Add structured logs around job attempts, duration, and final label changes.

## Open questions

- What debounce window is enough for profile + organization backfill: 1s, 2s, or 3s?
- What retry policy should be used for URL checks and HF failures?
- How long should URL cache entries stay valid?
