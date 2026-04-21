# Deploying the Certified Organization Labeler fork on Railway

This guide assumes **two Railway services**:

- the **app service** (Next.js dashboard + labeler backend)
- a separate **Tap service** with its own database and volume

The app service connects to Tap over `TAP_URL`.

---

## 1) Architecture

| Service | Responsibility | Storage |
|---------|----------------|---------|
| App service | Dashboard, API routes, labeler process | `activity-log.db`, `labels.db` |
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
| `DID` | Labeler DID |
| `SIGNING_KEY` | Labeler private key |
| `LABELER_ENDPOINT` | Public HTTPS URL of the app service |
| `TAP_URL` | Required URL of the separate Tap service; no localhost default |

Usually needed for setup/sync:

| Variable | Description |
|----------|-------------|
| `BSKY_IDENTIFIER` | Labeler account handle or email |
| `BSKY_PASSWORD` | Labeler account password or app password |

Storage:

| Variable | Description | Example |
|----------|-------------|---------|
| `ACTIVITY_DB_PATH` | Activity log SQLite path | `/app/data/activity-log.db` |
| `LABELS_DB_PATH` | Label records SQLite path | `/app/data/labels.db` |

Optional:

| Variable | Description | Default |
|----------|-------------|---------|
| `HF_TOKEN` | Enables HuggingFace scoring | _(empty)_ |
| `HOST` | Labeler bind host | `0.0.0.0` |
| `LABELER_PORT` | Labeler HTTP port | `4100` |
| `METRICS_PORT` | Metrics port | `4101` |
| `RESET_DB` | Clear app DB files on startup | _(empty)_ |

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
| `$PORT` | App service | Railway routes web traffic here |
| `4100` | App service | Public labeler endpoint |
| `4101` | App service | Internal metrics only |
| `2480` | Tap service | Tap HTTP endpoint |

The app service must be able to reach `TAP_URL`; the Tap service does not need to live inside the app container.

---

## 5) Deployment flow

1. Deploy Tap and confirm it is healthy.
2. Set the app service `TAP_URL` to the Tap service URL.
3. Set the app service database paths to the mounted app volume.
4. Run `npm run setup` locally once to create the labeler credentials if needed.
5. Deploy the app service.

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

- Check `DID`, `SIGNING_KEY`, and `LABELER_ENDPOINT`
- Check the app logs for the labeler process error

### Emergency reset

- Set `RESET_DB=true` for one app-service restart to clear the app databases
- Reset the Tap service separately if you need to clear its cursor state
