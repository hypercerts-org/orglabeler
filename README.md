# Certified Organization Labeler

> Automated quality scoring for merged `app.certified.actor.profile` + `app.certified.actor.organization` data on AT Protocol

This fork monitors both `app.certified.actor.profile` and `app.certified.actor.organization` records, merges them by DID for display and classification context, and labels organizations based on how complete, consistent, and non-placeholder the organization record looks.

## Labels

| Label | Score | Meaning |
|-------|-------|---------|
| ⚠ Likely Test | 0-39 | Placeholder, junk, or obvious test data |
| ● Standard | 40-69 | A valid organization record with the basics filled in |
| ✦ High Quality | 70-100 | A complete organization record with several strong details |

## Quick Start

### Prerequisites
- Node.js 22+
- A Bluesky/AT Protocol account dedicated to the labeler

### Setup
```bash
git clone <repo>
cd orglabeler
npm install

# Works with any AT Protocol PDS (not just bsky.social)
npm run setup -- your-handle.bsky.social your-password https://labeler.yourdomain.com

# Example with custom PDS:
npm run setup -- satyam2.climateai.org yourpassword https://labeler.climateai.org
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
- Labeler process → `labels.db` + `activity-log.db`

The Tap sidecar listens to both `app.certified.actor.profile` and `app.certified.actor.organization`, merges them by DID for actor context, and still applies labels to the organization record URI.

The Next.js dashboard reads from `activity-log.db`.

The labeler auto-detects the PDS for non-bsky.social accounts via DID document resolution, so it works across any AT Protocol PDS.

## Scoring

Scores `app.certified.actor.organization` records on 13 completeness signals (100 points total):

| Signal | Max Points | What it checks |
|--------|-----------|----------------|
| Display Name | 5 | Uses a real display name instead of DID-only fallback |
| Description | 10 | Has a profile description |
| Organization Type | 5 | Includes at least one organization type value |
| Website Present | 10 | Has a public website URL |
| Website Resolves | 15 | Public website resolves successfully |
| Website Matches Name | 5 | Website domain matches the display name |
| Organization URLs Present | 5 | Includes at least one organization URL |
| Organization URLs Resolve | 5 | At least one organization URL resolves successfully |
| Location | 10 | Has a valid organization location reference |
| Founded Date | 5 | Has a valid founded date |
| Founded Date Age | 5 | Founded date is at least one year old |
| Avatar | 10 | Has an avatar image |
| Banner | 10 | Has a banner image |

Test detection: regex patterns catch common placeholder strings (`test`, `asdf`, `lorem ipsum`, etc.) and override the score to force ⚠ Likely Test.

### URL enrichment

Tap handlers never fetch URLs. New records are scored immediately with optimistic provisional URL resolve points for valid-looking public URLs. A detachable in-process URL enrichment worker checks those URLs later, stores results in the independent `url_checks` cache table, and queues a recompute only when cached URL state changes.

Set `URL_ENRICHMENT_ENABLED=false` to disable URL checks completely. When disabled, scoring keeps the provisional URL behavior and does not depend on the `url_checks` table.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dashboard |
| `npm run labeler` | Start labeler backend |
| `npm run dev:service` | Start dashboard + labeler concurrently |
| `npm run start:service` | Start Caddy reverse proxy + production dashboard + labeler process |
| `npm run setup` | Initialize labeler account |
| `npm run set-labels` | Push/update label definitions |
| `npm run build` | Production build |
| `npm run reset` | Clear databases (fresh start) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DID` | (set by setup) | Labeler account DID |
| `SIGNING_KEY` | (set by setup) | secp256k1 private key hex |
| `BSKY_IDENTIFIER` | (set by setup) | Account handle |
| `BSKY_PASSWORD` | (set by setup) | Account password or app password |
| `PDS_URL` | (auto-detected) | PDS endpoint URL |
| `NEXT_PUBLIC_LABELER_ENDPOINT` | https://labeler.<handle> | Public HTTPS URL for the labeler |
| `PORT` | 8080 | Public HTTP port listened to by Caddy; hosted platforms usually set this |
| `NEXT_PORT` | 3000 | Internal Next.js port behind Caddy |
| `HOST` | 127.0.0.1 | Labeler server bind address; keep local when Caddy is in the same container |
| `LABELER_PORT` | 4100 | Internal labeler server port behind Caddy |
| `METRICS_PORT` | 4101 | Prometheus metrics port |
| `TAP_URL` | required | URL of the separate Tap service (no localhost default) |
| `TAP_ADMIN_PASSWORD` | empty | App-side password for Tap admin auth; must match the Tap service when auth is enabled |
| `ACTIVITY_DB_PATH` | `activity-log.db` | Activity log database path |
| `URL_ENRICHMENT_ENABLED` | `true` | Enables async URL checks through the detachable `url_checks` cache |
| `URL_CHECK_TIMEOUT_MS` | `4000` | Timeout for one URL resolution attempt |
| `URL_CHECK_INTERVAL_MS` | `1000` | Poll interval for the URL enrichment worker |
| `URL_CHECK_MAX_URLS_PER_DID` | `5` | Maximum profile/organization URLs cached and checked per DID |

Tap runtime settings belong on the Tap service. If the Tap service sets `TAP_ADMIN_PASSWORD`, set the same value on the app service so health checks and the Tap WebSocket can authenticate.

## Production Deployment

Deploy the app service and Tap as separate services. The app service runs the dashboard plus labeler backend and connects to Tap over `TAP_URL`; Tap owns its own database, volume, lifecycle, and any Tap-specific auth settings.

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
