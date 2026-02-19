# Certified Labeler

> Automated quality scoring for hypercert activity records on AT Protocol

Monitors `org.hypercerts.claim.activity` records on the network and labels authors based on how completely they fill out their activity claims. Fights spam/test hypercerts with tiered quality labels.

## Labels

| Label | Score | Meaning |
|-------|-------|---------|
| ✦ High Quality | 70-100 | Well-documented, comprehensive activity claim |
| ● Standard | 40-69 | Adequate but could be more detailed |
| ◌ Draft | 15-39 | Minimal information, work in progress |
| ⚠ Likely Test | 0-14 | Spam or placeholder data |

## Quick Start

### Prerequisites
- Node.js 20+
- A Bluesky account dedicated to the labeler

### Setup
```bash
git clone <repo>
cd certified-labeler
npm install

# Initialize the labeler account (requires email confirmation)
npm run setup -- your-handle.bsky.social your-password https://labeler.yourdomain.com
```

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
│  AT Protocol    │    │  Labeler Process  │    │  Next.js         │
│  Firehose       │───▶│  (port 4100)     │    │  Dashboard       │
│  (Jetstream)    │    │                  │    │  (port 3000)     │
└─────────────────┘    │  Score → Label   │    │                  │
                       │  → Log to SQLite │    │  Reads from      │
                       │                  │    │  activity-log.db │
                       └────────┬─────────┘    └────────┬─────────┘
                                │                       │
                         ┌──────▼───────┐        ┌──────▼───────┐
                         │ labels.db    │        │activity-log.db│
                         │ (AT Proto)   │        │ (dashboard)  │
                         └──────────────┘        └──────────────┘
```

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

## Environment Variables

See `.env.example` for all variables.

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
- **Labeler:** @skyware/labeler, @skyware/jetstream
- **Database:** SQLite (better-sqlite3)
- **Design:** Inspired by [Hyperscan](https://hyperscan.dev)
