# Agent Instructions

This is the **Hyperlabel** — an AT Protocol labeler for scoring hypercert activity quality.

## Project Structure

```
src/
├── app/                    # Next.js App Router (dashboard)
│   ├── api/               # API routes (read from activity-log.db)
│   ├── feed/              # Feed page with tier filtering
│   ├── globals.css        # Tailwind v4 design system (OKLCH)
│   ├── layout.tsx         # Root layout with fonts + theme
│   └── page.tsx           # Dashboard page
├── components/            # React components (all "use client")
├── labeler/               # Standalone labeler process (NO React/Next.js imports)
│   ├── start.ts           # Entry point: spawns Tap sidecar + LabelerServer
│   ├── tap-consumer.ts    # Tap client, SimpleIndexer record handler
│   ├── server.ts          # Label application logic
│   ├── setup.ts           # Account setup (PDS-aware)
│   ├── set-labels.ts      # Push label definitions
│   └── reset-db.ts        # Database reset utility
└── lib/                   # Shared code (used by BOTH labeler and dashboard)
    ├── config.ts          # Environment config
    ├── constants.ts       # Label definitions + scoring thresholds
    ├── db.ts              # SQLite activity log (better-sqlite3)
    ├── resolve-pds.ts     # PDS resolution from DID document
    ├── scorer.ts          # Activity record scoring engine
    └── types.ts           # TypeScript interfaces (zero runtime imports)
```

## Key Architectural Rules

1. **src/labeler/ must NEVER import from React or Next.js** — it runs as a standalone Node.js process
2. **src/lib/ is shared** — importable by both labeler and Next.js, but must not import from src/labeler/
3. **src/components/ and src/app/ are Next.js only** — they can import from src/lib/ but never from src/labeler/
4. **Two databases**: labels.db (AT Proto, managed by @skyware/labeler) and activity-log.db (dashboard, managed by src/lib/db.ts)
5. **Design system**: Tailwind CSS v4, OKLCH colors (hue 260), Syne display font, no component libraries
6. **Code style**: no semicolons, single quotes, 2-space indent

## Development

```bash
npm run dev:all          # Start dashboard + labeler together
npm run build            # Verify Next.js build passes
npm run reset            # Clear databases for fresh start
```

## Issue Tracking

This project uses **hb** (heartbeads) for issue tracking.

```bash
hb ready                 # Find available work
hb show <id>             # View issue details
hb update <id> --status in_progress  # Claim work
hb close <id>            # Complete work
hb sync                  # Sync with git
```
