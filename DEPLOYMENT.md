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
3. the Tap consumer that scores incoming records and writes to SQLite

Tap is a separate service. The labeler process connects to it via `TAP_URL` instead of launching it locally, and startup should fail if `TAP_URL` is missing.

Caddy is the public front door for the app service. It routes dashboard and API traffic to Next.js, and routes public label distribution XRPC methods directly to the local labeler server at `http://127.0.0.1:LABELER_PORT`:

- `com.atproto.label.queryLabels`
- `com.atproto.label.subscribeLabels`

The direct Caddy route is required for `subscribeLabels`, because it is a WebSocket endpoint.

## Environment variables

### Required for the running service

- `DID` — labeler DID
- `SIGNING_KEY` — labeler private key used by `@skyware/labeler`

These are validated at startup by `src/lib/config.ts`.

### Required for first-time labeler setup / label sync

- `BSKY_IDENTIFIER`
- `BSKY_PASSWORD`
- `NEXT_PUBLIC_LABELER_ENDPOINT`

Use these with `npm run setup` and `npm run set-labels` when registering the labeler account and label definitions.

### Required for the app service to reach Tap

- `TAP_URL` — required URL of the separate Tap service

### SQLite paths

Set these to persistent storage in hosted environments:

- `ACTIVITY_DB_PATH` (default `activity-log.db`)
- `LABELS_DB_PATH` (default `labels.db`)

### Tap service storage

The Tap service manages its own persistent SQLite file and any Tap-specific settings outside this repo.

If your Tap deployment uses admin auth, configure `TAP_ADMIN_PASSWORD` on the Tap service itself.

### Optional

- `HF_TOKEN` — enables HuggingFace classification; if unset, HF scoring stays disabled
- `PDS_URL` — overrides PDS discovery from the DID document
- `PORT` — public Caddy HTTP port (hosted platforms usually set this; default fallback `8080`)
- `NEXT_PORT` — internal Next.js HTTP port (`3000` by default)
- `HOST` — bind host for the labeler server (`127.0.0.1` is recommended when Caddy runs in the same container)
- `LABELER_PORT` — internal labeler HTTP port (`4100` by default)
- `METRICS_PORT` — metrics port (`4101` by default)
- `RESET_DB=true` — deletes the SQLite files before startup

## Persistence requirements

This fork uses two SQLite databases in the app service and one in the Tap service:

- `activity-log.db` — dashboard data and scoring history
- `labels.db` — AT Protocol label records
- `tap.db` — Tap cursor / replay state (Tap service)

The app service should mount a volume for `activity-log.db` and `labels.db`. The Tap service should mount its own volume for `tap.db`. If the files are not persisted, redeploys will lose dashboard history and Tap will replay from an old or empty cursor.

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
