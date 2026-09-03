# Agent Instructions

This is the **Certified Organization Labeler** fork — an AT Protocol labeler for certified actor organizations.

## Project Structure

```
src/
├── app/                    # Next.js App Router (dashboard)
│   ├── api/               # API routes (read from configured ACTIVITY_DB_PATH)
│   ├── feed/              # Feed page with tier filtering
│   ├── globals.css        # Tailwind v4 design system (OKLCH)
│   ├── layout.tsx         # Root layout with fonts + theme
│   └── page.tsx           # Dashboard page
├── components/            # React UI components (client components only where interactive)
├── labeler/               # Standalone labeler process (NO React/Next.js imports)
│   ├── start.ts           # Entry point: LabelerServer + workers + external Tap connection
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
4. **Two app databases**: `LABELS_DB_PATH` (AT Proto, managed by @skyware/labeler) and `ACTIVITY_DB_PATH` (dashboard, managed by src/lib/db.ts)
5. **Design system**: Tailwind CSS v4, OKLCH colors (hue 260), Syne display font, no component libraries
6. **Code style**: no semicolons, single quotes, 2-space indent

## Development

```bash
npm run dev:service     # Start dashboard + labeler together
npm run build           # Verify Next.js build passes
npm run test            # Run Node test suite
npm run reset           # Clear local databases for fresh start
```

## Documentation Maintenance

When behavior, configuration, deployment, scripts, or operator workflow changes, check whether the relevant docs need updates in the same change. Every normal pull request needs a Changeset fragment under `.changeset/`; use a release fragment for user- or operator-visible changes and an empty fragment when the application version should not change. The generated `Release` pull request and GitHub Release workflow are maintained separately from Railway deployment operations.

Current docs to consider:

- `README.md` — project overview, setup, scripts, env vars, production shape
- `docs/RELEASING.md` — contributor and maintainer Changesets/GitHub Release workflow
- `.changeset/README.md` — Changesets authoring and empty-fragment guidance
- `DEPLOYMENT.md` — generic hosted deployment guidance
- `RAILWAY.md` — Railway-specific deployment guidance
- `AGENTS.md` — agent-facing architecture, workflow, and maintenance instructions
- `src/app/docs/page.tsx` — dashboard documentation shown in the app
- `.agents/skills/orglabeler/SKILL.md` — downstream consumer integration guidance
- `.env.example` — documented environment variable defaults/examples
- `.github/workflows/release.yml` — automated versioning, tag, and GitHub Release workflow; keep its Changesets action inputs aligned with the current v2 model

If a new documentation file is introduced, add it to this list and include when it should be checked.
