# Deploying the Certified Organization Labeler fork on Railway

This guide assumes **two Railway services**:

- the **app service** (Next.js dashboard + labeler backend)
- a separate **Tap service** with its own database and volume

The app service connects to Tap over `TAP_URL`.

---

## 1) Architecture

| Service | Responsibility | Storage |
|---------|----------------|---------|
| App service | Dashboard, API routes, labeler process | configured `ACTIVITY_DB_PATH`, `LABELS_DB_PATH` |
| Tap service | Firehose replay / indexing | `tap.db` |

Do not share the Tap database between services. Each service should have its own volume.

---

## 2) App service setup

1. Create a Railway service from this repository.
2. Add a persistent volume for the app database files.
3. Set the required environment variables below.
4. Deploy the app service with the repository Dockerfile.

### App service environment variables

Required:

| Variable | Description |
|----------|-------------|
| `DID` | Labeler account DID |
| `SIGNING_KEY` | Private key material used by `@skyware/labeler` to sign labels |
| `NEXT_PUBLIC_LABELER_ENDPOINT` | Public HTTPS URL of the app service, for example `https://orglabeler.hypercerts.dev` |
| `TAP_URL` | Required URL of the separate Tap service; no localhost default |

Required when Tap admin auth is enabled:

| Variable | Description |
|----------|-------------|
| `TAP_ADMIN_PASSWORD` | App-side Tap admin password; must match the Tap service |

Usually needed for setup/sync:

| Variable | Description |
|----------|-------------|
| `LABELER_IDENTIFIER` | Labeler account identifier, for example `orglabeler.certified.one` |
| `LABELER_PASSWORD` | Labeler account password or app password |
| `PDS_URL` | Optional labeler account PDS override; setup normally resolves it from the DID document |

The labeler account identifier is the signing source. `NEXT_PUBLIC_LABELER_ENDPOINT` is the hosted app endpoint and may be a different domain.

Storage:

| Variable | Description | Code default | Railway example |
|----------|-------------|--------------|-----------------|
| `ACTIVITY_DB_PATH` | SQLite path for snapshots, assessments, jobs, admin sessions, and encrypted OAuth login state | `/data/activity-log.db` | `/app/data/activity-log.db` |
| `LABELS_DB_PATH` | Label records SQLite path | `/data/labels.db` | `/app/data/labels.db` |

Optional:

| Variable | Description | Default |
|----------|-------------|---------|
| `TYPESAFE_API_KEY` | Enables Jev assessment; without it saved records wait for configuration | _(empty)_ |
| `JEV_MODEL` | TypeSafe model identifier | `jev-latest` |
| `JEV_REQUEST_TIMEOUT_MS` | TypeSafe request timeout | `15000` |
| `JEV_TEST_THRESHOLD` | Test-data threshold for `likely-test` | `0.98` |
| `JEV_MAX_TEST_PROBABILITY_FOR_QUALITY` | Maximum test probability allowed for quality labels | `0.02` |
| `JEV_PURPOSE_THRESHOLD` | Minimum substantive-purpose probability | `0.95` |
| `JEV_QUALITY_THRESHOLD` | Minimum quality confidence | `0.95` |
| `HYPERSCAN_RECORD_URL_BASE` | Base URL for dashboard links to source AT Protocol records | `https://hyperscan.dev/data` |
| `TEST_PDS_HOSTS` | PDS hosts whose actors should always be labeled `likely-test` | _(empty)_ |
| `ADMIN_DIDS` | Comma-separated admin DID allowlist; empty or invalid values deny access | _(empty)_ |
| `ADMIN_ORIGIN` | Stable exact dashboard origin; HTTPS in production (`http://localhost` for development) | _(empty)_ |
| `ADMIN_OAUTH_SIGNING_KEY` | Stable base64-encoded unencrypted P-256 PKCS#8 private-key PEM for OAuth client assertions | _(secret)_ |
| `ADMIN_OAUTH_ENCRYPTION_KEY` | 32 random bytes as 64 hex characters; encrypts temporary OAuth PKCE/DPoP state in `ACTIVITY_DB_PATH` | _(secret)_ |
| `ADMIN_SESSION_TTL_MS` | Maximum local admin session lifetime | `28800000` |
| `NEXT_PUBLIC_SITE_URL` | Dashboard metadata base URL | `VERCEL_URL` or `http://localhost:3000` |
| `NEXT_PUBLIC_COMMIT_SHA` | Optional deployment SHA shown in the footer | `RAILWAY_GIT_COMMIT_SHA` when available |
| `NEXT_PUBLIC_DEPLOY_TIME` | Optional deployment timestamp shown in the footer | image build time via `scripts/build.sh` |
| `NEXT_PORT` | Internal Next.js port behind Caddy | `3000` |
| `HOST` | Labeler bind host | `0.0.0.0` |
| `LABELER_PORT` | Internal labeler HTTP port behind Caddy | `4100` |
| `METRICS_PORT` | Metrics port | `4101` |
| `RESET_DB` | Clear configured app DB files on startup; remove after one reset | _(empty)_ |
| `URL_ENRICHMENT_ENABLED` | Enable detachable async URL checks through `url_checks` | `true` |
| `URL_CHECK_INTERVAL_MS` | URL worker polling interval | `1000` |
| `URL_CHECK_DISCOVERY_INTERVAL_MS` | New URL discovery scan interval | `30000` |
| `URL_CHECK_TIMEOUT_MS` | Timeout for one URL resolution attempt | `4000` |
| `URL_CHECK_OK_TTL_MS` | Freshness window for successful URL checks | `604800000` |
| `URL_CHECK_FAILED_TTL_MS` | Downgrade window for hard failed URL checks | `86400000` |
| `URL_CHECK_RETRY_BASE_MS` | Initial retry delay for temporary failures | `300000` |
| `URL_CHECK_MAX_RETRY_MS` | Maximum retry delay for temporary failures | `3600000` |
| `URL_CHECK_HARD_FAILURE_ATTEMPTS` | Hard failures needed before URL evidence is recorded as failed | `2` |
| `URL_CHECK_MAX_URLS_PER_DID` | Maximum profile/organization URLs cached and checked per DID | `5` |

Admin login at `/admin` uses the official Node OAuth client and requests exactly the `atproto` scope. The stable client metadata, public JWKS, and callback routes derive from `ADMIN_ORIGIN`: `/api/admin/oauth/client-metadata`, `/api/admin/oauth/jwks`, and `/api/admin/oauth/callback`. Set all four OAuth variables before deployment and keep the signing/encryption keys stable in Railway's secret variables. Generate keys outside the deployment environment; never commit them. Rotating the encryption key invalidates logins already in progress. Tokens are not persisted after callback verification; remote revocation is attempted before the temporary SDK session is discarded. There is no shared-password fallback.

Production requires HTTPS. Although the app accepts `http://localhost` for development, an external OAuth server may be unable to fetch the local JWKS endpoint. Use a publicly reachable HTTPS development tunnel if the provider cannot handle loopback metadata.

Start the app with:

```bash
npm run start:service
```

---

## 3) Tap service setup

Deploy Tap as its own Railway service or equivalent container.

### Tap service environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TAP_ADMIN_PASSWORD` | Optional admin password | _(empty)_ |

### Tap storage

Tap manages its SQLite files at its default location. Mount a separate persistent volume for the Tap service so the default `tap.db` file and its SQLite companion files (`-wal` / `-shm`) survive restarts.

Do not point Tap at a custom database path unless the service itself exposes that option.

---

## 4) Ports

| Port | Service | Notes |
|------|---------|-------|
| `$PORT` | App service | Caddy listens here and routes traffic |
| `3000` | App service | Internal Next.js dashboard behind Caddy |
| `4100` | App service | Internal labeler endpoint behind Caddy |
| `4101` | App service | Internal metrics only |
| `2480` | Tap service | Tap HTTP endpoint |

The app service must be able to reach `TAP_URL`; the Tap service does not need to live inside the app container.

---

## 5) Deployment flow

1. Deploy Tap and confirm it is healthy.
2. Set the app service `TAP_URL` to the Tap service URL.
3. Set the app service database paths to the mounted app volume.
4. Run `npm run setup` locally once to create the labeler credentials if needed.
5. Deploy the app service. Caddy will route `/xrpc/com.atproto.label.queryLabels` and `/xrpc/com.atproto.label.subscribeLabels` directly to the labeler, and all dashboard/API routes to Next.js.

---

## 6) Troubleshooting

### App cannot reach Tap

- Confirm `TAP_URL` points to the Tap service, not `localhost`
- Confirm the Tap service is running and reachable from the app service
- Check Tap logs for startup or SQLite errors

### SQLite database locked

- Run one replica per service
- Keep each SQLite file on its own volume

### App service health check fails

- Check `DID`, `SIGNING_KEY`, and `NEXT_PUBLIC_LABELER_ENDPOINT`
- Check that Caddy is listening on `$PORT`
- Check the app logs for Next.js or labeler process errors

### Emergency reset

- Set `RESET_DB=true` for one app-service restart to clear the app databases
- Reset the Tap service separately if you need to clear its cursor state
