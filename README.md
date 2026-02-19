# Hyperlabel

> Automated quality scoring for hypercert activity records on AT Protocol

Monitors `org.hypercerts.claim.activity` records on the network and labels authors based on how completely they fill out their activity claims. Fights spam/test hypercerts with tiered quality labels.

## Labels

| Label | Score | Meaning |
|-------|-------|---------|
| ✦ High Quality | 75-100 | Well-documented, comprehensive activity claim |
| ● Standard | 50-74 | Adequate but could be more detailed |
| ◌ Draft | 20-49 | Minimal information, work in progress |
| ⚠ Likely Test | 0-19 | Spam or placeholder data |

## Quick Start

### Prerequisites
- Node.js 22+
- A Bluesky account dedicated to the labeler

### Setup
```bash
git clone <repo>
cd hyperlabel
npm install

# Works with any AT Protocol PDS (not just bsky.social)
npm run setup -- your-handle.bsky.social your-password https://labeler.yourdomain.com

# Example with custom PDS:
npm run setup -- satyam2.climateai.org yourpassword https://labeler.climateai.org
```

The setup script automatically resolves your account's PDS endpoint from the DID document. It works with any AT Protocol PDS, not just bsky.social.

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

The labeler auto-detects the PDS for non-bsky.social accounts via DID document resolution, so it works seamlessly across any AT Protocol PDS.

## Scoring

Scores `org.hypercerts.claim.activity` records on 9 criteria (100 points total):

| Criterion | Max Points | What it checks |
|-----------|-----------|----------------|
| Title Quality | 15 | Length, proper phrasing |
| Summary Quality | 15 | Short description depth |
| Description | 20 | Long description presence + depth |
| Image | 10 | Visual representation present |
| Work Scope | 10 | Scope definition present |
| Contributors | 15 | Contributor list with weights/details |
| Locations | 5 | Geographic references |
| Date Range | 5 | Start + end dates |
| Rights | 5 | Rights reference present |

Test detection: Regex patterns catch common test strings ("test", "asdf", "lorem ipsum", etc.) and override the score to force ⚠ Likely Test.

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
