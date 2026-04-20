# Certified Organization Labeler

> Automated quality scoring for `app.certified.actor.organization` records on AT Protocol

This fork monitors `app.certified.actor.organization` records and labels organizations based on how complete, consistent, and non-placeholder the record data looks.

## Labels

| Label | Score | Meaning |
|-------|-------|---------|
| ⚠ Likely Test | 0-34 | Placeholder, junk, or obvious test data |
| ● Standard | 35-74 | A valid organization record with the basics filled in |
| ✦ High Quality | 75-100 | A complete organization record with several strong details |

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
# Start the app service (dashboard + labeler)
npm run dev:service

# Or start separately:
npm run dev            # Dashboard on http://localhost:3000
npm run dev:labeler    # Labeler backend on port 4100 + metrics on 4101
```

Tap runs as a separate service. Point `TAP_URL` at that service's URL; there is no localhost fallback and the app will not start without it.

## Architecture

The runtime is split into three pieces:

- AT Protocol relay → separate Tap service
- Tap service → labeler process over `TAP_URL`
- Labeler process → `labels.db` + `activity-log.db`

The Next.js dashboard reads from `activity-log.db`.

The labeler auto-detects the PDS for non-bsky.social accounts via DID document resolution, so it works across any AT Protocol PDS.

## Scoring

Scores `app.certified.actor.organization` records on 5 signals (100 points total):

| Signal | Max Points | What it checks |
|--------|-----------|----------------|
| Organization Type | 30 | Whether the record has a useful set of organization type values |
| URLs | 30 | Presence of valid, unique, non-local website links |
| Location | 20 | Whether a location is provided |
| Founded Date | 15 | Valid founding date |
| Created Date | 15 | Valid creation date |

Test detection: regex patterns catch common placeholder strings (`test`, `asdf`, `lorem ipsum`, etc.) and override the score to force ⚠ Likely Test.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dashboard |
| `npm run dev:labeler` | Start labeler backend |
| `npm run dev:service` | Start dashboard + labeler concurrently |
| `npm run start:service` | Start the production app service processes |
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
| `LABELER_ENDPOINT` | https://labeler.<handle> | Public HTTPS URL for the labeler |
| `HOST` | 127.0.0.1 | Labeler server bind address |
| `LABELER_PORT` | 4100 | Labeler server port |
| `METRICS_PORT` | 4101 | Prometheus metrics port |
| `TAP_URL` | required | URL of the separate Tap service (no localhost default) |
| `ACTIVITY_DB_PATH` | `activity-log.db` | Activity log database path |

Tap-specific settings belong on the Tap service, not the app service. This repo only needs `TAP_URL` here; set `TAP_ADMIN_PASSWORD` on the Tap service if you use Tap admin auth.

## Production Deployment

Deploy the app service and Tap as separate services. The app service runs the dashboard plus labeler backend and connects to Tap over `TAP_URL`; Tap owns its own database, volume, lifecycle, and any Tap-specific auth settings.

The labeler backend (port 4100) must be accessible via HTTPS for AT Protocol clients. Use a reverse proxy:

```nginx
server {
    listen 443 ssl;
    server_name labeler.yourdomain.com;
    
    location / {
        proxy_pass http://127.0.0.1:4100;
        proxy_set_header Host $host;
    }
}
```

## Tech Stack

- **Runtime:** Node.js 22
- **Framework:** Next.js 16, React 19, TypeScript
- **Styling:** Tailwind CSS v4, OKLCH colors
- **Labeler:** @skyware/labeler, @atproto/tap
- **Database:** SQLite (better-sqlite3)
