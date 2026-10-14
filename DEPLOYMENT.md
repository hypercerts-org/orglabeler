# Deployment guide

This repository deploys the **Certified Organization Labeler** as two services:

- **App service**: Next.js dashboard + labeler process
- **Tap service**: separate Tap instance with its own SQLite file and volume

The app service connects to Tap over `TAP_URL`.

## Build and start

Current scripts:

- `npm run build` → `next build`
- `npm run start` → `next start`
- `npm run dev:service` → runs `npm run dev` and `npm run labeler` together
- `npm run labeler` → `tsx src/labeler/start.ts`
- `npm run start:service` → runs Caddy, `npm run start:next`, and `npm run labeler` together
- `npm run start:next` → starts Next.js on `NEXT_PORT` (default `3000`)
- `npm run start:proxy` → starts Caddy using `Caddyfile`

For hosted deployment, the image build uses `scripts/build.sh`, which sets `NEXT_PUBLIC_DEPLOY_TIME` and then runs `npm run build`.

## Runtime shape

At runtime, the labeler process starts:

1. the AT Protocol labeler server on `LABELER_PORT` (default `4100`)
2. the Prometheus metrics server on `METRICS_PORT` (default `4101`)
3. the Tap consumer that saves records and queues durable Jev assessments

Tap is a separate service. The labeler process connects to it via `TAP_URL` instead of launching it locally, and startup should fail if `TAP_URL` is missing.

Caddy is the public front door for the app service. It routes dashboard and API traffic to Next.js, and routes public label distribution XRPC methods directly to the local labeler server at `http://127.0.0.1:LABELER_PORT`:

- `com.atproto.label.queryLabels`
- `com.atproto.label.subscribeLabels`

The direct Caddy route is required for `subscribeLabels`, because it is a WebSocket endpoint.

## Environment variables

### Required for the running app service

- `DID` — labeler account DID
- `SIGNING_KEY` — private key material used by `@skyware/labeler` to sign labels
- `TAP_URL` — URL of the separate Tap service; there is no localhost fallback
- `NEXT_PUBLIC_LABELER_ENDPOINT` — public HTTPS base URL for the dashboard and labeler XRPC endpoint

### Required for first-time labeler setup / label sync

- `LABELER_IDENTIFIER` — labeler account identifier, for example `orglabeler.certified.one`
- `LABELER_PASSWORD` — labeler account password or app password
- `PDS_URL` — optional override for the labeler account PDS; setup normally resolves this from the DID document

Use these with `npm run setup` and `npm run set-labels` when registering the labeler account and label definitions. The labeler account identifier is the signing source; `NEXT_PUBLIC_LABELER_ENDPOINT` is the hosted app endpoint and may be a different domain.

### SQLite paths

Set these to persistent storage in hosted environments:

- `ACTIVITY_DB_PATH` (code default `/data/activity-log.db`)
- `LABELS_DB_PATH` (code default `/data/labels.db`)

### Tap service settings

The Tap service manages its own persistent SQLite file and any Tap-specific settings outside this repo.

If your Tap deployment uses admin auth, configure `TAP_ADMIN_PASSWORD` on the Tap service itself and set the same `TAP_ADMIN_PASSWORD` on the app service so health checks and the Tap WebSocket can authenticate.

### Optional app settings

- `TYPESAFE_API_KEY` — enables Jev assessment; if unset, saved records wait for configuration and existing labels remain marked stale
- `JEV_MODEL` — TypeSafe model identifier; default `jev-latest`
- `JEV_REQUEST_TIMEOUT_MS` — TypeSafe request timeout; default `15000`
- `JEV_TEST_THRESHOLD`, `JEV_MAX_TEST_PROBABILITY_FOR_QUALITY`, `JEV_PURPOSE_THRESHOLD`, `JEV_QUALITY_THRESHOLD` — confidence thresholds; defaults `0.98`, `0.02`, `0.95`, and `0.95`
- `HYPERSCAN_RECORD_URL_BASE` — base URL used when the dashboard links to source AT Protocol records; default `https://hyperscan.dev/data`
- `TEST_PDS_HOSTS` — comma-separated authoritative test-PDS overrides; URL enrichment waits for PDS resolution and skips matching hosts
- `ADMIN_DIDS` — comma-separated allowlist of admin DIDs; empty or invalid values deny access
- `ADMIN_ORIGIN` — exact stable dashboard origin, HTTPS in production; `http://localhost` is accepted for local development
- `ADMIN_OAUTH_SIGNING_KEY` — stable base64-encoded unencrypted P-256 PKCS#8 private-key PEM for confidential OAuth client assertions
- `ADMIN_OAUTH_ENCRYPTION_KEY` — 32 random bytes encoded as 64 hexadecimal characters; encrypts temporary PKCE/DPoP login state stored in `ACTIVITY_DB_PATH`
- `ADMIN_SESSION_TTL_MS` — maximum local admin session lifetime; default `28800000`

The admin client metadata, public JWKS, and callback URLs derive from `ADMIN_ORIGIN`: `/api/admin/oauth/client-metadata`, `/api/admin/oauth/jwks`, and `/api/admin/oauth/callback`. Configure the origin before deployment and keep both OAuth keys stable in the platform secret manager. Generate and store the keys outside the deployment environment; never commit them. Rotating the encryption key invalidates in-flight logins. The client requests exactly `atproto`; OAuth credentials are not stored after callback verification, and revocation is attempted before the temporary SDK session is discarded.

`http://localhost` is accepted for development, but an external OAuth server may not be able to fetch a JWKS endpoint on the developer's machine. Use an HTTPS development tunnel if the provider cannot handle loopback metadata. Admin mutations continue to require the exact origin and CSRF token; the app has no shared-password fallback.
- `PORT` — public Caddy HTTP port (hosted platforms usually set this; Caddy fallback `8080`)
- `NEXT_PORT` — internal Next.js HTTP port (`3000` by default)
- `HOST` — bind host for the labeler server (`0.0.0.0` by default; `127.0.0.1` is recommended when only same-container Caddy should reach it)
- `LABELER_PORT` — internal labeler HTTP port (`4100` by default)
- `METRICS_PORT` — metrics port (`4101` by default)
- `RESET_DB=true` — deletes configured app SQLite files plus WAL/SHM companions before startup; remove it after one reset
- `URL_ENRICHMENT_ENABLED` — enables async URL checks through `url_checks`; default `true`
- `URL_CHECK_INTERVAL_MS` — poll interval for processing due URL checks; default `1000`
- `URL_CHECK_DISCOVERY_INTERVAL_MS` — how often the URL worker scans local snapshots for newly referenced URLs; default `30000`
- `URL_CHECK_TIMEOUT_MS` — timeout for one URL resolution attempt; default `4000`
- `URL_CHECK_OK_TTL_MS` — freshness window for successful URL checks; default `604800000`
- `URL_CHECK_FAILED_TTL_MS` — downgrade window for hard failed URL checks before another attempt; default `86400000`
- `URL_CHECK_RETRY_BASE_MS` — initial retry delay for temporary URL check failures; default `300000`
- `URL_CHECK_MAX_RETRY_MS` — maximum retry delay for temporary URL check failures; default `3600000`
- `URL_CHECK_HARD_FAILURE_ATTEMPTS` — hard failures required before URL evidence is recorded as failed; default `2`
- `URL_CHECK_MAX_URLS_PER_DID` — maximum profile/organization URLs cached and checked per DID; default `5`

## Persistence requirements

This fork uses two SQLite databases in the app service and one in the Tap service:

- `ACTIVITY_DB_PATH` — actor snapshots, Jev assessments, durable jobs, admin sessions, and encrypted short-lived OAuth login state
- `LABELS_DB_PATH` — AT Protocol label records
- Tap service database — Tap cursor / replay state

The app service should mount a volume for the configured `ACTIVITY_DB_PATH` and `LABELS_DB_PATH`. The Tap service should mount its own volume for its database. If the files are not persisted, redeploys will lose dashboard history and Tap will replay from old or empty state.

Also persist the `-wal` and `-shm` companions that SQLite may create beside each DB file.

## Recommended deployment flow

1. Build the app service with the repository Dockerfile or an equivalent container build.
2. Deploy Tap as its own service and mount a separate persistent volume for its database files.
3. Mount a persistent volume for the app service's SQLite files.
4. Set `DID`, `SIGNING_KEY`, and `NEXT_PUBLIC_LABELER_ENDPOINT` before first startup.
5. Set `TAP_URL` to the Tap service URL.
6. Set `ACTIVITY_DB_PATH` and `LABELS_DB_PATH` to paths on the app volume.
7. Start the app service with `npm run start:service`.
8. Run `npm run setup` once for the labeler account, then `npm run set-labels` if label definitions need to be re-pushed.

## Hosted environment notes

- Run a single replica only for each service; SQLite state is not safe to share across multiple hosts.
- Expose Caddy on the host-assigned HTTP port and set `NEXT_PUBLIC_LABELER_ENDPOINT` to that public URL. Caddy will route `/xrpc/*` label methods to the labeler and dashboard/API routes to Next.js.
- Keep Tap reachable from the app service at `TAP_URL`; do not rely on a localhost default.
- If you need to reset state on a hosted platform, set `RESET_DB=true` for one restart, then remove it.
