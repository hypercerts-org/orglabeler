# Deploying Hyperlabel on Railway

This guide covers everything you need to deploy Hyperlabel on [Railway](https://railway.app) — from first-time setup to debugging failed deploys.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Initial Setup](#initial-setup)
4. [Environment Variables](#environment-variables)
5. [Persistent Volume (SQLite)](#persistent-volume-sqlite)
6. [Ports](#ports)
7. [Custom Domain](#custom-domain)
8. [How Auto-Deploy Works](#how-auto-deploy-works)
9. [Verifying a Deployment](#verifying-a-deployment)
10. [Debugging Failed Deploys](#debugging-failed-deploys)
11. [Emergency Database Reset](#emergency-database-reset)
12. [CI and Branch Protection](#ci-and-branch-protection)

---

## Architecture Overview

A single Railway service runs two processes concurrently via `concurrently`:

| Process | What it does |
|---------|-------------|
| **Next.js** (port from `$PORT` env var) | Dashboard UI + API routes (`/api/stats`, `/api/recent`, `/xrpc/...`) |
| **Labeler** | AT Protocol labeler server + Tap sidecar + HuggingFace classifier |

The labeler process itself spawns a third subprocess — **Tap** — which is a binary copied from `ghcr.io/bluesky-social/indigo/tap:latest` during the Docker build.

All three share the same filesystem, which is why a single Railway service with a mounted volume is the right topology. Do not run multiple instances — SQLite does not support concurrent writes from separate processes/hosts.

---

## Prerequisites

- A [Railway](https://railway.app) account
- The GitHub repository connected to Railway (Railway reads from GitHub)
- A Bluesky account set up as a labeler (run `npm run setup` locally first to generate your `DID` and `SIGNING_KEY`)

---

## Initial Setup

### 1. Create a new Railway project

1. Go to [railway.app/new](https://railway.app/new)
2. Choose **Deploy from GitHub repo**
3. Select the `hyperlabel` repository
4. Railway will detect `railway.toml` automatically and use the `Dockerfile`

### 2. Set environment variables

Before the first deploy can succeed, you must set the required environment variables. See [Environment Variables](#environment-variables) below.

In Railway: **Service → Variables → Add Variable**

### 3. Add a persistent volume

This is critical. Without a volume, all SQLite databases are wiped on every redeploy.

See [Persistent Volume (SQLite)](#persistent-volume-sqlite) below.

### 4. Trigger the first deploy

Once variables and the volume are set, Railway will automatically trigger a build. You can also click **Deploy** manually from the Railway dashboard.

The build:
1. Pulls the Tap binary from `ghcr.io/bluesky-social/indigo/tap:latest`
2. Installs Node.js dependencies (`npm ci`)
3. Runs `scripts/build.sh` which bakes the deploy timestamp + commit SHA into the Next.js bundle
4. Starts both the Next.js server and labeler process via `npm run start:all`

Railway then polls `GET /api/stats` — if it returns `200` within 30 seconds, the deploy is live.

---

## Environment Variables

Set these in **Railway → Service → Variables**.

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DID` | DID of your labeler Bluesky account | `did:plc:abc123...` |
| `SIGNING_KEY` | Hex-encoded private key for the labeler | `a1b2c3...` |
| `BSKY_IDENTIFIER` | Bluesky handle or email of the labeler account | `hyperlabel.bsky.social` |
| `BSKY_PASSWORD` | Bluesky app password (not your account password) | `xxxx-xxxx-xxxx-xxxx` |
| `LABELER_ENDPOINT` | Public HTTPS URL of this Railway service | `https://hyperlabel-production.up.railway.app` |

### Required for persistent storage (set after adding volume)

| Variable | Description | Value |
|----------|-------------|-------|
| `ACTIVITY_DB_PATH` | Path to activity log SQLite DB | `/app/data/activity-log.db` |
| `LABELS_DB_PATH` | Path to AT Proto labels SQLite DB | `/app/data/labels.db` |
| `TAP_DB_PATH` | Path to Tap sidecar SQLite DB | `/app/data/tap.db` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `HF_TOKEN` | HuggingFace API token (enables AI scoring) | _(empty — scoring disabled)_ |
| `HOST` | Host to bind servers to | `0.0.0.0` |
| `LABELER_PORT` | Port for the AT Proto labeler server | `4100` |
| `METRICS_PORT` | Port for Prometheus metrics | `4101` |
| `TAP_BIND` | Bind address for the Tap sidecar | `:2480` |
| `TAP_URL` | Internal URL for Tap health checks | `http://localhost:2480` |
| `TAP_ADMIN_PASSWORD` | Admin password for Tap | _(empty)_ |
| `PDS_URL` | PDS URL override (auto-detected from DID doc) | _(auto)_ |

### Railway-injected (automatic, do not set manually)

| Variable | Description |
|----------|-------------|
| `RAILWAY_GIT_COMMIT_SHA` | Git SHA of the deployed commit — used by the footer |
| `PORT` | Railway sets this to `3000` automatically |

---

## Persistent Volume (SQLite)

Hyperlabel uses three SQLite databases. Without a persistent volume, they are reset on every deploy.

### Adding the volume

1. In your Railway project, go to **Service → Volumes**
2. Click **Add Volume**
3. Set the mount path to `/app/data`
4. Save

### Setting the database paths

After adding the volume, set these three environment variables:

```
ACTIVITY_DB_PATH=/app/data/activity-log.db
LABELS_DB_PATH=/app/data/labels.db
TAP_DB_PATH=/app/data/tap.db
```

### Why this matters

| Database | Contains |
|----------|----------|
| `activity-log.db` | All scored hypercert activity records (dashboard data) |
| `labels.db` | AT Protocol label records (managed by `@skyware/labeler`) |
| `tap.db` | Tap sidecar cursor + firehose state (determines replay position) |

If `tap.db` is wiped, Tap will backfill from the beginning of the firehose, which can take a while and generate duplicate scoring events.

---

## Ports

Railway injects a `PORT` environment variable at runtime. Next.js automatically reads `$PORT` and binds to it — you will see something like `http://localhost:8080` in the deploy logs. **Do not assume port `3000`** — the actual port depends on what Railway assigns.

| Port | Service | External? |
|------|---------|-----------|
| `$PORT` (Railway-assigned) | Next.js dashboard + API | Yes — Railway routes all external HTTP traffic here |
| `4100` | AT Proto labeler endpoint | Yes — must be accessible for AT Protocol label queries |
| `2480` | Tap sidecar | No — localhost only |
| `4101` | Prometheus metrics | No — internal only |

> **Important:** Port `4100` (the labeler endpoint) must be publicly reachable for the AT Protocol network. Railway exposes all `EXPOSE`d ports — check **Service → Settings → Networking** to confirm `4100` has a public URL, then set `LABELER_ENDPOINT` to that URL.

---

## Custom Domain

1. Go to **Service → Settings → Networking → Custom Domain**
2. Add your domain (e.g. `labeler.yourdomain.com`)
3. If Railway asks you to pick a port, **leave it blank or select the Railway-assigned port** — do not type `3000`. Railway will route traffic automatically based on the `$PORT` env var it injects at runtime.
4. Railway provides CNAME/ALIAS DNS records to set at your registrar
5. Once DNS propagates, update `LABELER_ENDPOINT` to your custom domain URL

---

## How Auto-Deploy Works

Auto-deploy is triggered by any push to `master` that touches files matching `watchPatterns` in `railway.toml`:

```
src/**
lexicons/**
scripts/**
package.json
package-lock.json
Dockerfile
railway.toml
tsconfig.json
```

Changes to other files (e.g. `RAILWAY.md`, `AGENTS.md`) do **not** trigger a deploy.

### Deploy sequence

```
git push → Railway detects push → Docker build starts
  → pulls tap binary
  → npm ci
  → scripts/build.sh (bakes timestamp + SHA into Next.js)
  → npm run start:all
  → Railway polls GET /api/stats every few seconds
  → 200 OK → deploy goes live
  → non-200 or timeout → deploy fails, previous version stays live
```

On failure, Railway will retry up to 5 times (`restartPolicyMaxRetries = 5`) before marking the deployment as failed.

---

## Verifying a Deployment

The footer on every page shows the **commit SHA** and **deploy timestamp** baked into the build:

```
deployed Fri, 19 Mar 2026 11:52:00 UTC · f9d6fe3
```

To verify the deployed version matches what you expect:

```bash
# Get the short SHA of the latest commit on master
git log --oneline -1 master
# → f9d6fe3 feat: add railway deployment setup
```

Compare the 7-character SHA in the footer against the output above. If they match, the latest push is live.

---

## Debugging Failed Deploys

### View build logs

Railway → **Deployments → (failed deploy) → View Logs**

Look for errors in the build phase (Docker build output) vs the run phase (application logs).

### Common issues

#### Healthcheck timeout

```
Healthcheck failed after 30s — /api/stats did not return 200
```

**Causes:**
- A required environment variable is missing (check `DID`, `SIGNING_KEY`)
- The labeler server failed to start — check logs for `Fatal error in labeler process`
- The Next.js server took too long to start (rare)

**Fix:** Set all required env vars and redeploy. Check application logs for the actual error.

---

#### SQLite database locked / SQLITE_BUSY

**Cause:** Two instances are running simultaneously (e.g. during a rolling deploy), both trying to write the same SQLite file.

**Fix:** `railway.toml` already sets `numReplicas = 1` which prevents this. If you see it anyway, ensure you haven't overridden this in the Railway dashboard.

---

#### Tap health check times out / "Tap did not become healthy after 30 attempts"

```
[labeler] Fatal error in labeler process
[labeler]   "message": "Tap did not become healthy after 30 attempts"
```

**Cause:** If `TAP_ADMIN_PASSWORD` is set, Tap's admin auth middleware wraps **all routes including `/health`**, returning `401` instead of `200`. Older versions of the code treated any non-`200` response as "not ready". This has been fixed — the health check now accepts any response under `500` as "tap is up".

If you see this on a fresh deployment after the fix, it means Tap itself is failing to start. Check the lines immediately before the error in the logs for a Tap-level error.

---

#### Tap binary fails to start

```
Failed to spawn tap process
Error: ENOENT: tap binary not found
```

**Cause:** The `ghcr.io/bluesky-social/indigo/tap:latest` image couldn't be pulled during build, or the binary isn't compatible with the host architecture.

**Fix:** Check that Railway's builder can pull from `ghcr.io`. Railway builds on `linux/amd64` — the Tap image is built for this architecture, so it should work. If not, check Railway's build logs for the Docker pull error.

---

#### Missing musl library

```
error while loading shared libraries: libmusl.so.1: cannot open shared object file
```

**Cause:** The Tap binary is compiled against musl libc (Alpine-based), but the container is Debian-based.

**Fix:** Already handled — the Dockerfile installs `musl` via `apt-get`. If you see this error, check that the `apt-get install` step in the Dockerfile completed successfully.

---

#### TypeScript build error

```
Type error: ...
```

**Cause:** A type error in the source code (blocked by CI, but could happen if CI was bypassed).

**Fix:** Run `npx tsc --noEmit` locally to find and fix the error, then push.

---

## Emergency Database Reset

If the databases are in a bad state and you need to start fresh:

1. In Railway, set the environment variable:
   ```
   RESET_DB=true
   ```
2. Redeploy (or let Railway restart the service)
3. On startup, the labeler will delete all database files from the volume
4. **Immediately** remove `RESET_DB` (set it to empty or delete it) and redeploy again

> Warning: This deletes all activity records, labels, and Tap state. The labeler will backfill from the firehose, but historical label data is gone permanently.

---

## CI and Branch Protection

### CI workflow

Every push to `master` and every PR targeting `master` runs `.github/workflows/ci.yml`:

1. `npm ci` — install dependencies
2. `npx tsc --noEmit` — TypeScript type-check
3. `npm run build` — full Next.js build

This catches type errors and build failures before they reach Railway.

### Enabling branch protection (recommended)

To require CI to pass before a PR can be merged:

1. Go to **GitHub → Repository → Settings → Branches**
2. Click **Add branch protection rule**
3. Branch name pattern: `master`
4. Check **Require status checks to pass before merging**
5. Search for and select `Type-check & Build` (the CI job name)
6. Check **Require branches to be up to date before merging**
7. Save

After this, any PR that fails the type-check or build will be blocked from merging.
