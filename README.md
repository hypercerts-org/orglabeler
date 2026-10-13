# Certified Organization Labeler

> Jev-based quality assessments for merged `app.certified.actor.profile` + `app.certified.actor.organization` data on AT Protocol

This fork monitors both `app.certified.actor.profile` and `app.certified.actor.organization` records, merges them by DID for display and assessment context, and publishes confident quality decisions against actor DIDs. Jev assessments are provisional content-quality signals, not identity or legitimacy verification.

## Labels

| Label | Decision | Meaning |
|-------|----------|---------|
| ⚠ Likely Test | Configured test-PDS override or confident Jev test-data decision | The actor is on an authoritative test PDS or its records contain contextual evidence of synthetic/test data |
| ● Standard | Confident Jev decision | Substantive, coherent organization context with standard-level detail |
| ✦ High Quality | Confident Jev decision | Specific, coherent organization context with substantial useful detail |

Uncertain outcomes do not publish a quality label. An incomplete or ambiguous record is not automatically assigned `standard` or `likely-test`.

## Quick Start

### Prerequisites
- Node.js 22.13+ (within Node 22)
- An AT Protocol account dedicated to the labeler

### Setup
```bash
git clone <repo>
cd orglabeler
npm install

# The first argument is the labeler account identifier; the final argument is the public app/labeler endpoint.
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

## Releases

Every normal pull request needs either a release changeset from `npm run changeset` or an empty changeset from `npm run changeset:empty` when no version bump is needed. Maintainers merge the generated **Release** pull request; the workflow then creates a Git tag and GitHub Release without publishing the private package to npm. See [docs/RELEASING.md](docs/RELEASING.md) for the contributor and maintainer flow.

## Architecture

The runtime is split into three pieces:

- AT Protocol relay → separate Tap service
- Tap service → labeler process over `TAP_URL`
- Labeler process → configured `LABELS_DB_PATH` + `ACTIVITY_DB_PATH` SQLite databases

The Tap service listens to both `app.certified.actor.profile` and `app.certified.actor.organization`, merges them by DID for actor context, and applies quality labels to the actor DID. Fresh deployments should wipe the app and Tap volumes together so old local labels, activity rows, and Tap cursor state are not reused.

The Next.js dashboard reads from the configured `ACTIVITY_DB_PATH`.

The labeler auto-detects the account PDS via DID document resolution, so it works across any AT Protocol PDS.

## Jev assessment

The labeler sends the latest saved `app.certified.actor.profile` and `app.certified.actor.organization` records, plus cached URL-resolution evidence, to Jev in one structured request. Record content is treated as untrusted evidence, not instructions. The assessment is a provisional content-quality signal; it is not identity verification, registration verification, or proof of legitimacy.

Jev returns separate test-data and substantive-purpose probabilities plus a quality choice with probabilities for `high_quality`, `standard`, and `uncertain`. The adapter validates the complete response and applies configurable confidence thresholds. Uncertain evidence stays uncertain and never creates a new quality label. A prior published label is retained and marked stale when evidence changes, when configuration is missing, or when the result is uncertain.

Configured `TEST_PDS_HOSTS` are authoritative: matching actors receive `likely-test` without a Jev request. Other saved actors wait in `awaiting-configuration` when `TYPESAFE_API_KEY` is absent; adding a key and restarting queues eligible records for assessment. Forced admin reassessment bypasses current-result reuse and requests fresh inference. `/admin` supports AT Protocol OAuth login for allowlisted DIDs and exposes protected reassessment controls; there is no password fallback.

### Admin access

Admin login uses `@atproto/oauth-client-node` as a confidential server-side OAuth client. It uses PKCE, PAR, and DPoP and requests exactly the `atproto` scope. OAuth tokens are used only during callback verification and are not persisted; the app attempts to revoke them before discarding the temporary SDK session. Successful login creates a separate opaque local session whose token and CSRF values are stored only as hashes. Protected requests recheck the DID allowlist, and mutations require the exact configured origin plus CSRF validation.

Configure `ADMIN_DIDS`, a stable public `ADMIN_ORIGIN`, `ADMIN_OAUTH_SIGNING_KEY`, and `ADMIN_OAUTH_ENCRYPTION_KEY`. The metadata, JWKS, and callback URLs are derived from the origin:

- Client metadata: `/api/admin/oauth/client-metadata`
- Public signing keys: `/api/admin/oauth/jwks`
- OAuth callback: `/api/admin/oauth/callback`

`ADMIN_OAUTH_SIGNING_KEY` is a stable base64-encoded, unencrypted P-256 PKCS#8 private-key PEM. `ADMIN_OAUTH_ENCRYPTION_KEY` is 32 random bytes encoded as 64 hexadecimal characters; it encrypts the short-lived PKCE/DPoP pre-auth state in the activity database. Keep both secrets stable and in the deployment secret manager; changing the encryption key invalidates in-flight logins. Never commit either value. Production requires HTTPS. `http://localhost` is accepted for development, but an external authorization server may be unable to fetch the local JWKS URL; use an HTTPS development tunnel for end-to-end OAuth testing if the provider cannot handle loopback metadata.

### URL evidence

Tap handlers never fetch URLs. The separate URL-enrichment worker stores resolution state in the `url_checks` cache and queues assessment work when that evidence changes. With `TEST_PDS_HOSTS` configured, URL checks wait for actor PDS resolution, skip matching test PDS hosts, and run only for known non-test PDS hosts. Set `URL_ENRICHMENT_ENABLED=false` to disable external URL checks; assessments continue using cached or unknown URL evidence.

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
| `LABELER_IDENTIFIER` | (set by setup) | Labeler account identifier for setup and label definition updates |
| `LABELER_PASSWORD` | (set by setup) | Labeler account password or app password |
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
| `ACTIVITY_DB_PATH` | `/data/activity-log.db` | SQLite database for actor snapshots, assessments, durable jobs, admin sessions, and encrypted short-lived OAuth login state |
| `LABELS_DB_PATH` | `/data/labels.db` | AT Protocol label SQLite database path used by `@skyware/labeler` |
| `RESET_DB` | unset | When set to `true`, deletes configured app database files plus WAL/SHM files on startup; remove it after the reset |
| `TEST_PDS_HOSTS` | empty | Comma-separated PDS hosts whose actors are authoritatively labeled `likely-test`; URL checks wait for PDS resolution and skip matching hosts |
| `TYPESAFE_API_KEY` | empty | TypeSafe API key for Jev; without it saved non-test records wait for configuration and new non-test labels are not assigned |
| `JEV_MODEL` | `jev-latest` | TypeSafe model identifier used for assessment requests |
| `JEV_REQUEST_TIMEOUT_MS` | `15000` | Maximum time allowed for one TypeSafe request |
| `JEV_TEST_THRESHOLD` | `0.98` | Minimum test-data probability that produces `likely-test` |
| `JEV_MAX_TEST_PROBABILITY_FOR_QUALITY` | `0.02` | Maximum test-data probability allowed before considering quality tiers |
| `JEV_PURPOSE_THRESHOLD` | `0.95` | Minimum substantive-purpose probability required for a quality label |
| `JEV_QUALITY_THRESHOLD` | `0.95` | Minimum confidence required for a standard or high-quality label |
| `ADMIN_DIDS` | empty | Comma-separated verified admin DID allowlist; only these identities can sign in |
| `ADMIN_ORIGIN` | empty | Stable exact dashboard origin for OAuth metadata/callback URLs and mutation-origin checks; HTTPS in production (`http://localhost` for development) |
| `ADMIN_OAUTH_SIGNING_KEY` | empty | Stable base64-encoded P-256 PKCS#8 private key used for confidential OAuth client assertions; keep in the secret manager |
| `ADMIN_OAUTH_ENCRYPTION_KEY` | empty | 32-byte encryption key as 64 hex characters for encrypted, short-lived OAuth PKCE/DPoP state |
| `ADMIN_SESSION_TTL_MS` | `28800000` | Maximum server-side admin session lifetime |
| `HYPERSCAN_RECORD_URL_BASE` | `https://hyperscan.dev/data` | Base URL used when the dashboard links to source AT Protocol records |
| `URL_ENRICHMENT_ENABLED` | `true` | Enables async URL checks through the detachable `url_checks` cache |
| `URL_CHECK_INTERVAL_MS` | `1000` | Poll interval for processing due URL checks |
| `URL_CHECK_DISCOVERY_INTERVAL_MS` | `30000` | How often the URL worker scans local snapshots for newly referenced URLs |
| `URL_CHECK_TIMEOUT_MS` | `4000` | Timeout for one URL resolution attempt |
| `URL_CHECK_OK_TTL_MS` | `604800000` | Freshness window for successful URL checks |
| `URL_CHECK_FAILED_TTL_MS` | `86400000` | Downgrade window for hard failed URL checks before another attempt |
| `URL_CHECK_RETRY_BASE_MS` | `300000` | Initial retry delay for temporary URL check failures |
| `URL_CHECK_MAX_RETRY_MS` | `3600000` | Maximum retry delay for temporary URL check failures |
| `URL_CHECK_HARD_FAILURE_ATTEMPTS` | `2` | Hard failures required before URL evidence is recorded as failed |
| `URL_CHECK_MAX_URLS_PER_DID` | `5` | Maximum profile/organization URLs cached and checked per DID |

Tap runtime settings belong on the Tap service. If the Tap service sets `TAP_ADMIN_PASSWORD`, set the same value on the app service so health checks and the Tap WebSocket can authenticate.

## Production Deployment

Deploy the app service and Tap as separate services. The app service runs the dashboard plus labeler backend and connects to Tap over `TAP_URL`; Tap owns its own database, volume, lifecycle, and any Tap-specific auth settings.

Set `NEXT_PUBLIC_LABELER_ENDPOINT` to the public app URL, for example `https://orglabeler.hypercerts.dev`. The labeler account identifier can still be `orglabeler.certified.one`; that account is the signing source, not necessarily the app endpoint.

The production app uses Caddy as the front door. Caddy routes public AT Protocol XRPC label methods directly to the labeler process and everything else to Next.js:

```txt
/xrpc/com.atproto.label.queryLabels     -> 127.0.0.1:4100
/xrpc/com.atproto.label.subscribeLabels -> 127.0.0.1:4100
/*                                      -> 127.0.0.1:3000
```

This is important because `subscribeLabels` uses WebSockets, which need a real reverse proxy rather than the Next.js `fetch()` proxy fallback.

## Tech Stack

- **Runtime:** Node.js 22.13+ within Node 22
- **Framework:** Next.js 16, React 19, TypeScript
- **Styling:** Tailwind CSS v4, OKLCH colors
- **Labeler:** @skyware/labeler, @atproto/tap
- **Database:** SQLite (better-sqlite3)
