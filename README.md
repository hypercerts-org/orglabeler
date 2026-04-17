# Certified Profile Labeler

> Automated quality scoring for `app.certified.actor.profile` records on AT Protocol

This fork monitors `app.certified.actor.profile` records and labels authors based on how complete and well-formed their profile data is. It uses tiered quality labels to distinguish polished profiles from sparse or placeholder records.

## Labels

| Label | Score | Meaning |
|-------|-------|---------|
| ✦ High Quality | 75-100 | Complete, well-presented profile with strong detail |
| ● Standard | 50-74 | Solid profile with the main fields filled in |
| ◌ Draft | 20-49 | Sparse profile that looks unfinished |
| ⚠ Likely Test | 0-19 | Placeholder, spam, or obvious test data |

## Quick Start

### Prerequisites
- Node.js 22+
- A Bluesky account dedicated to the labeler

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
4. Push label definitions (✦ High Quality, ● Standard, ◌ Draft, ⚠ Likely Test)
5. Write credentials to `.env`

### Run

```bash
# Start both dashboard and labeler
npm run dev:all

# Or start separately:
npm run dev            # Dashboard on http://localhost:3000
npm run dev:labeler    # Labeler backend on port 4100 + metrics on 4101
```

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  AT Protocol    │    │  Tap Sidecar     │    │  Next.js         │
│  Relay          │───▶│  (port 2480)     │    │  Dashboard       │
│  (firehose)     │    │  Backfill + Live │    │  (port 3000)     │
└─────────────────┘    └────────┬─────────┘    │                  │
                                 │              │  Reads from      │
                        ┌────────▼─────────┐    │  activity-log.db │
                        │  Labeler Process  │    └────────┬─────────┘
                        │  (port 4100)     │             │
                        │  Score → Label   │      ┌──────▼───────┐
                        │  → Log to SQLite │      │activity-log.db│
                        └────────┬─────────┘      │ (dashboard)  │
                                 │                └──────────────┘
                          ┌──────▼───────┐
                          │ labels.db    │
                          │ (AT Proto)   │
                          └──────────────┘
```

The labeler auto-detects the PDS for non-bsky.social accounts via DID document resolution, so it works across any AT Protocol PDS.

## Scoring

Scores `app.certified.actor.profile` records on 9 criteria (100 points total):

| Criterion | Max Points | What it checks |
|-----------|-----------|----------------|
| Display Name | 15 | Length, clarity, and whether it looks like a real name |
| Short Description | 15 | Presence and quality of the profile summary |
| Description | 20 | Longer bio or about section depth |
| Image | 10 | Profile image present |
| Scope | 10 | Structured scope or focus information present |
| Contributors | 15 | Contributor list with weights/details |
| Locations | 5 | Location references present |
| Date Range | 5 | Start and end dates present |
| Rights | 5 | Rights or attribution references present |

Test detection: regex patterns catch common placeholder strings (`test`, `asdf`, `lorem ipsum`, etc.) and override the score to force ⚠ Likely Test.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dashboard |
| `npm run dev:labeler` | Start labeler backend |
| `npm run dev:all` | Start both concurrently |
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
| `LABELER_ENDPOINT` | https://labeler.\<handle\> | Public HTTPS URL for the labeler |
| `HOST` | 127.0.0.1 | Labeler server bind address |
| `LABELER_PORT` | 4100 | Labeler server port |
| `METRICS_PORT` | 4101 | Prometheus metrics port |
| `TAP_URL` | http://localhost:2480 | Tap sidecar HTTP URL |
| `TAP_ADMIN_PASSWORD` | (empty) | Tap admin auth password |
| `TAP_BIND` | `:2480` | Tap server bind address |
| `TAP_DB_PATH` | `tap.db` | Tap SQLite database path |
| `ACTIVITY_DB_PATH` | activity-log.db | Activity log database path |

## Production Deployment

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

- **Framework:** Next.js 15, TypeScript
- **Styling:** Tailwind CSS v4, OKLCH colors
- **Labeler:** @skyware/labeler, @atproto/tap, indigo/tap
- **Database:** SQLite (better-sqlite3)
- **Design:** Inspired by [Hyperscan](https://hyperscan.dev)
