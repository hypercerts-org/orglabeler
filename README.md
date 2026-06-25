# Certified Organization Labeler

> Automated quality scoring for merged `app.certified.actor.profile` + `app.certified.actor.organization` data on AT Protocol

This fork monitors both `app.certified.actor.profile` and `app.certified.actor.organization` records, merges them by DID for display and classification context, and labels actor DIDs based on how complete, consistent, and non-placeholder the organization profile looks.

## Labels

| Label | Score | Meaning |
|-------|-------|---------|
| ⚠ Likely Test | signal-based | Explicit test evidence, such as a configured test PDS or obvious placeholder identity data |
| ● Standard | 0-69 without test signals | A non-test organization record that does not meet the high-quality threshold |
| ✦ High Quality | 70+ without test signals | A complete organization record with several strong details |

## Quick Start

### Prerequisites
- Node.js 22+
- A Bluesky/AT Protocol account dedicated to the labeler

### Setup
```bash
git clone <repo>
cd orglabeler
npm install

# The first argument is the labeler account handle; the final argument is the public app/labeler endpoint.
npm run setup -- orglabeler.certified.one your-password https://orglabeler.hypercerts.dev
```

The setup script automatically resolves your account's PDS endpoint from the DID document, so it works with any AT Protocol PDS.

The setup script will:
1. Generate a signing key
2. Send a PLC confirmation email (check your inbox)
3. Register the account as a labeler on the AT Protocol network
4. Push label definitions (⚠ Likely Test, ● Standard, ✦ High Quality)
5. Write credentials to `.env`

### Run

```bash
# Start the app service locally (dashboard + labeler, without Caddy)
npm run dev:service

# Or start separately:
npm run dev            # Dashboard on http://localhost:3000
npm run labeler        # Labeler backend on port 4100 + metrics on 4101

# Production start runs Caddy + Next + labeler
npm run start:service   # Caddy on $PORT, Next on NEXT_PORT, labeler on LABELER_PORT
```

Tap runs as a separate service. Point `TAP_URL` at that service's URL; there is no localhost fallback and the app will not start without it.

## Architecture

The runtime is split into three pieces:

- AT Protocol relay → separate Tap service
- Tap service → labeler process over `TAP_URL`
- Labeler process → configured `LABELS_DB_PATH` + `ACTIVITY_DB_PATH` SQLite databases

The Tap service listens to both `app.certified.actor.profile` and `app.certified.actor.organization`, merges them by DID for actor context, and applies quality labels to the actor DID. Fresh deployments should wipe the app and Tap volumes together so old local labels, activity rows, and Tap cursor state are not reused.

The Next.js dashboard reads from the configured `ACTIVITY_DB_PATH`.

The labeler auto-detects the PDS for non-bsky.social accounts via DID document resolution, so it works across any AT Protocol PDS.

## Scoring

Scores `app.certified.actor.organization` records on 13 completeness signals (100 points total), plus a configurable actor-PDS trust bonus:

| Signal | Max Points | What it checks |
|--------|-----------|----------------|
| Display Name | 5 | Uses a real display name instead of DID-only fallback |
| Description | 10 | Has a profile description |
| Organization Type | 5 | Includes at least one organization type value |
| Website Present | 10 | Has a public website URL |
| Website Resolves | 15 | Valid-looking public website URL, with points removed after confirmed async URL failures |
| Website Matches Name | 5 | Website domain matches the display name |
| Organization URLs Present | 5 | Includes at least one organization URL |
| Organization URLs Resolve | 5 | At least one valid-looking organization URL, with points removed after confirmed async URL failures |
| Location | 10 | Has a valid organization location reference |
| Founded Date | 5 | Has a valid founded date |
| Founded Date Age | 5 | Founded date is at least one year old |
| Avatar | 10 | Has an avatar image |
| Banner | 10 | Has a banner image |
| Trusted PDS Bonus | configurable, default 10 | Actor DID resolves to a PDS host in `TRUSTED_PDS_HOSTS` (`certified.one` and `gainforest.id` by default) |

Trusted PDS scoring uses the actor's resolved PDS host, not the profile website or organization URLs. Actor PDS lookup runs through the durable recompute queue; the first record from an uncached actor may be labeled by content score first, then corrected once the actor DID document is resolved.

Test detection is intentionally conservative: hard `testSignals` such as configured `TEST_PDS_HOSTS`, obvious placeholder display names, placeholder domains, or `lorem ipsum` descriptions force ⚠ Likely Test. Softer data-quality issues become `validationNotes` for the dashboard but do not change the tier. Generic words like `test`, `testing`, or `tested` are allowed in profile descriptions, but still show as validation notes in short metadata fields such as organization type or URL labels.

### URL enrichment

Tap handlers never fetch URLs. New records are scored immediately with optimistic provisional URL resolve points for valid-looking public URLs. A detachable in-process URL enrichment worker checks those URLs later, stores results in the independent `url_checks` cache table, and queues a recompute only when cached URL state changes.

When `TEST_PDS_HOSTS` is configured, URL enrichment is PDS-aware: it defers URL checks until the actor PDS cache is fresh, skips actors on configured test PDS hosts, and only checks URLs for actors on non-test PDS hosts. Set `URL_ENRICHMENT_ENABLED=false` to disable URL checks completely. When disabled, scoring keeps the provisional URL behavior and does not depend on the `url_checks` table.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dashboard in development |
| `npm run build` | Build the production Next.js app |
| `npm run start` | Start the built Next.js dashboard only |
| `npm run start:next` | Start the built Next.js dashboard on `NEXT_PORT` |
| `npm run start:proxy` | Start Caddy from `Caddyfile` |
| `npm run labeler` | Start labeler backend |
| `npm run dev:service` | Start dashboard + labeler concurrently |
| `npm run start:service` | Start Caddy reverse proxy + production dashboard + labeler process |
| `npm run setup` | Initialize labeler account |
| `npm run set-labels` | Push/update label definitions |
| `npm run reset` | Clear local databases (fresh start) |
| `npm run test` | Run Node test suite |
| `npm run gen:lexicons` | Rebuild generated TypeScript lexicon files |

## Environment Variables

The code defaults are shown below. `.env.example` uses local SQLite paths for development; deployments should set database paths to the mounted persistent volume.

| Variable | Default | Description |
|----------|---------|-------------|
| `DID` | (set by setup; required) | Labeler account DID |
| `SIGNING_KEY` | (set by setup; required) | Private key material used by `@skyware/labeler` to sign labels |
| `BSKY_IDENTIFIER` | (set by setup) | Labeler account handle for setup and label definition updates |
| `BSKY_PASSWORD` | (set by setup) | Labeler account password or app password |
| `PDS_URL` | (auto-detected by setup) | PDS endpoint URL for the labeler account |
| `NEXT_PUBLIC_LABELER_ENDPOINT` | empty | Public HTTPS base URL for the dashboard and labeler XRPC endpoint, for example `https://orglabeler.hypercerts.dev` |
| `NEXT_PUBLIC_SITE_URL` | `VERCEL_URL` or `http://localhost:3000` | Dashboard metadata base URL |
| `NEXT_PUBLIC_COMMIT_SHA` | `RAILWAY_GIT_COMMIT_SHA` when available | Optional deployment SHA shown in the footer |
| `NEXT_PUBLIC_DEPLOY_TIME` | startup time | Optional deployment timestamp shown in the footer |
| `PORT` | `8080` | Public HTTP port listened to by Caddy; hosted platforms usually set this |
| `NEXT_PORT` | `3000` | Internal Next.js port behind Caddy |
| `HOST` | `0.0.0.0` | Labeler server bind address; set `127.0.0.1` when only same-container Caddy should reach it |
| `LABELER_PORT` | `4100` | Internal labeler server port behind Caddy |
| `METRICS_PORT` | `4101` | Prometheus metrics port |
| `TAP_URL` | empty; required | URL of the separate Tap service; there is no localhost fallback |
| `TAP_ADMIN_PASSWORD` | empty | App-side password for Tap admin auth; must match the Tap service when auth is enabled |
| `ACTIVITY_DB_PATH` | `/data/activity-log.db` | Dashboard activity log SQLite database path |
| `LABELS_DB_PATH` | `/data/labels.db` | AT Protocol label SQLite database path used by `@skyware/labeler` |
| `RESET_DB` | unset | When set to `true`, deletes configured app database files plus WAL/SHM files on startup; remove it after the reset |
| `TEST_PDS_HOSTS` | empty | Comma-separated PDS hosts whose actors should always be labeled `likely-test`; when set, URL enrichment waits for actor PDS resolution and skips matching test PDS hosts |
| `TRUSTED_PDS_HOSTS` | `certified.one,gainforest.id` | Comma-separated PDS hosts whose actors receive the trusted-PDS score bonus |
| `TRUSTED_PDS_BONUS` | `10` | Score points added when an actor's resolved PDS host matches `TRUSTED_PDS_HOSTS`; set to `0` to disable the bonus |
| `HYPERSCAN_RECORD_URL_BASE` | `https://hyperscan.dev/data` | Base URL used when the dashboard links to source AT Protocol records |
| `HF_TOKEN` | empty | Optional Hugging Face token; when set, enables the zero-shot authenticity classifier |
| `URL_ENRICHMENT_ENABLED` | `true` | Enables async URL checks through the detachable `url_checks` cache |
| `URL_CHECK_INTERVAL_MS` | `1000` | Poll interval for processing due URL checks |
| `URL_CHECK_DISCOVERY_INTERVAL_MS` | `30000` | How often the URL worker scans local snapshots for newly referenced URLs |
| `URL_CHECK_TIMEOUT_MS` | `4000` | Timeout for one URL resolution attempt |
| `URL_CHECK_OK_TTL_MS` | `604800000` | Freshness window for successful URL checks |
| `URL_CHECK_FAILED_TTL_MS` | `86400000` | Downgrade window for hard failed URL checks before another attempt |
| `URL_CHECK_RETRY_BASE_MS` | `300000` | Initial retry delay for temporary URL check failures |
| `URL_CHECK_MAX_RETRY_MS` | `3600000` | Maximum retry delay for temporary URL check failures |
| `URL_CHECK_HARD_FAILURE_ATTEMPTS` | `2` | Number of hard failures required before URL scoring removes resolve points |
| `URL_CHECK_MAX_URLS_PER_DID` | `5` | Maximum profile/organization URLs cached and checked per DID |

Tap runtime settings belong on the Tap service. If the Tap service sets `TAP_ADMIN_PASSWORD`, set the same value on the app service so health checks and the Tap WebSocket can authenticate.

## Production Deployment

Deploy the app service and Tap as separate services. The app service runs the dashboard plus labeler backend and connects to Tap over `TAP_URL`; Tap owns its own database, volume, lifecycle, and any Tap-specific auth settings.

Set `NEXT_PUBLIC_LABELER_ENDPOINT` to the public app URL, for example `https://orglabeler.hypercerts.dev`. The labeler account handle can still be `orglabeler.certified.one`; that handle is the signing source, not necessarily the app endpoint.

The production app uses Caddy as the front door. Caddy routes public AT Protocol XRPC label methods directly to the labeler process and everything else to Next.js:

```txt
/xrpc/com.atproto.label.queryLabels     -> 127.0.0.1:4100
/xrpc/com.atproto.label.subscribeLabels -> 127.0.0.1:4100
/*                                      -> 127.0.0.1:3000
```

This is important because `subscribeLabels` uses WebSockets, which need a real reverse proxy rather than the Next.js `fetch()` proxy fallback.

## Tech Stack

- **Runtime:** Node.js 22
- **Framework:** Next.js 16, React 19, TypeScript
- **Styling:** Tailwind CSS v4, OKLCH colors
- **Labeler:** @skyware/labeler, @atproto/tap
- **Database:** SQLite (better-sqlite3)
