# Deployment guide

This repository deploys the **Certified Organization Labeler** as one app with two runtime pieces:

- **Next.js dashboard + API** (`npm run start`)
- **Labeler process** (`tsx src/labeler/start.ts`), which also spawns the Tap sidecar

The production image runs both together with `npm run start:all`.

## Build and start

Current scripts:

- `npm run build` → `next build`
- `npm run start` → `next start`
- `npm run dev:labeler` → `tsx src/labeler/start.ts`
- `npm run start:all` → runs `npm run start` and `npm run dev:labeler` together

For hosted deployment, the image build uses `scripts/build.sh`, which sets `NEXT_PUBLIC_DEPLOY_TIME` and then runs `npm run build`.

## Runtime shape

At runtime, the labeler process starts:

1. the AT Protocol labeler server on `LABELER_PORT` (default `4100`)
2. the Prometheus metrics server on `METRICS_PORT` (default `4101`)
3. the Tap sidecar on `TAP_BIND` (default `:2480`)
4. the Tap consumer that scores incoming records and writes to SQLite

The dashboard proxies `/xrpc/*` requests to the local labeler server at `http://127.0.0.1:LABELER_PORT`.

## Environment variables

### Required for the running service

- `DID` — labeler DID
- `SIGNING_KEY` — labeler private key used by `@skyware/labeler`

These are validated at startup by `src/lib/config.ts`.

### Required for first-time labeler setup / label sync

- `BSKY_IDENTIFIER`
- `BSKY_PASSWORD`
- `LABELER_ENDPOINT`

Use these with `npm run setup` and `npm run set-labels` when registering the labeler account and label definitions.

### SQLite paths

Set these to persistent storage in hosted environments:

- `ACTIVITY_DB_PATH` (default `activity-log.db`)
- `LABELS_DB_PATH` (default `labels.db`)
- `TAP_DB_PATH` (default `tap.db`)

### Optional

- `HF_TOKEN` — enables HuggingFace classification; if unset, HF scoring stays disabled
- `PDS_URL` — overrides PDS discovery from the DID document
- `HOST` — bind host for the labeler server (`0.0.0.0` by default)
- `LABELER_PORT` — labeler HTTP port (`4100` by default)
- `METRICS_PORT` — metrics port (`4101` by default)
- `TAP_URL` — Tap health-check URL (`http://localhost:2480` by default)
- `TAP_BIND` — Tap bind address (`:2480` by default)
- `TAP_ADMIN_PASSWORD` — optional Tap admin password
- `RESET_DB=true` — deletes the SQLite files before startup

## Persistence requirements

This fork uses three SQLite databases:

- `activity-log.db` — dashboard data and scoring history
- `labels.db` — AT Protocol label records
- `tap.db` — Tap cursor / replay state

All three must live on a persistent volume mounted into the same filesystem namespace as the app. If the files are not persisted, redeploys will lose dashboard history and Tap will replay from an old or empty cursor.

Also persist the `-wal` and `-shm` companions that SQLite may create beside each DB file.

## Recommended deployment flow

1. Build the app with the repository Dockerfile or an equivalent container build.
2. Mount one persistent volume for the SQLite files.
3. Set `DID`, `SIGNING_KEY`, and `LABELER_ENDPOINT` before first startup.
4. Set `ACTIVITY_DB_PATH`, `LABELS_DB_PATH`, and `TAP_DB_PATH` to paths on the mounted volume.
5. Start the service with `npm run start:all`.
6. Run `npm run setup` once for the labeler account, then `npm run set-labels` if label definitions need to be re-pushed.

## Hosted environment notes

- Run a single replica only; SQLite and Tap cursor state are not safe to share across multiple hosts.
- Expose the dashboard on the host-assigned HTTP port and make the labeler endpoint publicly reachable at `LABELER_ENDPOINT`.
- If you need to reset state on a hosted platform, set `RESET_DB=true` for one restart, then remove it.
