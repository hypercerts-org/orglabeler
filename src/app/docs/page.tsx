'use client'

import { ScoreBadge } from '@/components/ScoreBadge'

const SCORING_CRITERIA = [
  {
    label: 'Organization type',
    points: 30,
    description: 'Scores the organizationType field: 12 for one distinct value, 20 for two, 30 for three or more.',
  },
  {
    label: 'URLs',
    points: 30,
    description: 'Scores valid organization URLs: 12 for one, 20 for two, 30 for three or more. Test or local URLs are ignored.',
  },
  {
    label: 'Location',
    points: 20,
    description: 'Awards 20 points when a location is present.',
  },
  {
    label: 'Founded date',
    points: 15,
    description: 'Awards 15 points for a valid, non-future foundedDate.',
  },
  {
    label: 'Created at',
    points: 15,
    description: 'Awards 15 points for a valid, non-future createdAt value.',
  },
]

const API_ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/stats',
    description: 'Dashboard statistics — total records, tier breakdown, 24h/7d record counts.',
    curl: `curl https://hyperlabel-production.up.railway.app/api/stats`,
  },
  {
    method: 'GET',
    path: '/api/recent?limit=20&offset=0&tier=all',
    description: 'Recent organization records with pagination and tier filtering. Valid tier values: all, likely-test, standard, high-quality.',
    curl: `curl "https://hyperlabel-production.up.railway.app/api/recent?limit=20&offset=0&tier=high-quality"`,
  },
  {
    method: 'GET',
    path: '/xrpc/com.atproto.label.queryLabels?uriPatterns=at://did:plc:*/app.certified.actor.organization/*',
    description: 'Query AT Protocol labels via the standard labeler endpoint. Use uriPatterns to filter record URIs and sources to scope the label source.',
    curl: `curl "https://hyperlabel-production.up.railway.app/xrpc/com.atproto.label.queryLabels?uriPatterns=at://did:plc:*/app.certified.actor.organization/*"`,
  },
]

export default function DocsPage() {
  return (
    <div className='py-8 space-y-10 animate-fade-in-up'>
      <div>
        <h1 className='font-[family-name:var(--font-syne)] text-2xl font-bold'>
          Documentation
        </h1>
        <p className='text-sm text-muted-foreground mt-1'>
          How Hyperlabel scores and labels organization records on AT Protocol.
        </p>
      </div>

      <section className='space-y-4'>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
          How it works
        </h2>

        <div className='border border-border rounded-lg bg-card p-4 overflow-x-auto'>
          <div className='flex items-center gap-2 min-w-max'>
            {[
              { step: 'Organization Record Created', sub: 'on AT Protocol' },
              { step: 'Detected', sub: 'via Tap' },
              { step: 'Scored', sub: '5 rubric fields + test signals' },
              { step: 'Labeled', sub: 'signed label applied to the record URI' },
            ].map(({ step, sub }, i, arr) => (
              <div key={step} className='flex items-center gap-2'>
                <div className='flex flex-col items-center gap-0.5'>
                  <span className='text-xs font-medium font-[family-name:var(--font-syne)]'>{step}</span>
                  <span className='text-[10px] text-muted-foreground'>{sub}</span>
                </div>
                {i < arr.length - 1 && (
                  <span className='text-muted-foreground text-sm select-none'>→</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <ol className='space-y-2 text-sm text-muted-foreground list-none'>
          <li className='flex gap-3'>
            <span className='font-[family-name:var(--font-syne)] font-bold text-foreground shrink-0'>1.</span>
            <span>
              Hyperlabel uses{' '}
              <span className='font-mono text-xs bg-secondary rounded px-1 py-0.5'>Tap</span>{' '}
              — Bluesky&apos;s official sync tool — to monitor the AT Protocol network for{' '}
              <span className='font-mono text-xs bg-secondary rounded px-1 py-0.5'>app.certified.actor.organization</span>{' '}
              records. Tap automatically discovers repos, backfills historical records from each PDS,
              and streams live events with cryptographic verification. This means records created
              before the labeler started are still scored.
            </span>
          </li>
          <li className='flex gap-3'>
            <span className='font-[family-name:var(--font-syne)] font-bold text-foreground shrink-0'>2.</span>
            <span>
              When a record is detected it is written to the log, scored, and then shown in the
              dashboard with its final tier.
            </span>
          </li>
          <li className='flex gap-3'>
            <span className='font-[family-name:var(--font-syne)] font-bold text-foreground shrink-0'>3.</span>
            <span>
              The scoring engine evaluates the record against 5 rubric fields worth 100 points in total.
              Test signals are checked first — any record that looks like placeholder data is labeled
              <ScoreBadge tier='likely-test' /> regardless of its numeric score.
            </span>
          </li>
          <li className='flex gap-3'>
            <span className='font-[family-name:var(--font-syne)] font-bold text-foreground shrink-0'>4.</span>
            <span>
              A signed AT Protocol label is applied to the record URI based on the score tier.
              When a record is rescored, the previous label is negated and replaced with the new one.
            </span>
          </li>
        </ol>
      </section>

      <section className='space-y-4'>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
          Scoring criteria
        </h2>
        <p className='text-sm text-muted-foreground'>
          Each organization record is evaluated on 5 criteria for a maximum of 100 points.
        </p>
        <div className='border border-border rounded-lg bg-card overflow-hidden'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b border-border'>
                <th className='text-left px-4 py-2.5 text-xs font-medium text-muted-foreground font-[family-name:var(--font-syne)]'>
                  Criterion
                </th>
                <th className='text-left px-4 py-2.5 text-xs font-medium text-muted-foreground font-[family-name:var(--font-syne)]'>
                  Description
                </th>
                <th className='text-right px-4 py-2.5 text-xs font-medium text-muted-foreground font-[family-name:var(--font-syne)]'>
                  Max pts
                </th>
              </tr>
            </thead>
            <tbody>
              {SCORING_CRITERIA.map(({ label, points, description }, i) => (
                <tr
                  key={label}
                  className={i < SCORING_CRITERIA.length - 1 ? 'border-b border-border' : ''}
                >
                  <td className='px-4 py-2.5 font-medium text-xs whitespace-nowrap'>{label}</td>
                  <td className='px-4 py-2.5 text-xs text-muted-foreground'>{description}</td>
                  <td className='px-4 py-2.5 text-right'>
                    <span className='font-mono text-xs font-medium'>{points}</span>
                  </td>
                </tr>
              ))}
              <tr className='border-t border-border bg-secondary/40'>
                <td className='px-4 py-2.5 font-[family-name:var(--font-syne)] font-bold text-xs'>Total</td>
                <td />
                <td className='px-4 py-2.5 text-right'>
                  <span className='font-mono text-xs font-bold'>100</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className='font-[family-name:var(--font-syne)] text-sm font-bold mt-4'>
          Test signals
        </h3>
        <p className='text-sm text-muted-foreground'>
          Matching any test signal forces <ScoreBadge tier='likely-test' />. There are no separate numeric deductions.
        </p>
        <div className='border border-border rounded-lg bg-card p-4 text-xs text-muted-foreground space-y-1'>
          <p className='font-medium text-foreground text-xs'>Common patterns</p>
          <ul className='space-y-1 pl-3'>
            <li>• Common junk values: <span className='font-mono bg-secondary rounded px-1'>test</span>, <span className='font-mono bg-secondary rounded px-1'>asdf</span>, <span className='font-mono bg-secondary rounded px-1'>lorem ipsum</span>, <span className='font-mono bg-secondary rounded px-1'>placeholder</span>, <span className='font-mono bg-secondary rounded px-1'>delete me</span>, <span className='font-mono bg-secondary rounded px-1'>ignore</span>, <span className='font-mono bg-secondary rounded px-1'>todo</span>.</li>
            <li>• Empty-style values: <span className='font-mono bg-secondary rounded px-1'>n/a</span>, <span className='font-mono bg-secondary rounded px-1'>none</span>, <span className='font-mono bg-secondary rounded px-1'>null</span>, <span className='font-mono bg-secondary rounded px-1'>undefined</span>, <span className='font-mono bg-secondary rounded px-1'>blank</span>.</li>
            <li>• Repeated characters and numeric-only titles are also treated as test data.</li>
          </ul>
        </div>
      </section>

      <section className='space-y-4'>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
          Quality tiers
        </h2>
        <p className='text-sm text-muted-foreground'>
          Scores map to three tiers. Test signals override the numeric score and always produce a
          <ScoreBadge tier='likely-test' /> label.
        </p>
        <div className='grid gap-3 sm:grid-cols-2'>
          {[
            {
              tier: 'high-quality' as const,
              range: '75 – 100',
              detail: 'Complete organization record with strong type, URL, location, and date coverage.',
            },
            {
              tier: 'standard' as const,
              range: '35 – 74',
              detail: 'Basic organization record with some useful metadata but not full coverage.',
            },
            {
              tier: 'likely-test' as const,
              range: '0 – 34 or test signals',
              detail: 'Contains test or placeholder data, or falls below the standard threshold.',
            },
          ].map(({ tier, range, detail }) => (
            <div key={tier} className='border border-border rounded-lg bg-card p-4 space-y-2'>
              <div className='flex items-center justify-between gap-2'>
                <ScoreBadge tier={tier} size='md' />
                <span className='font-mono text-xs text-muted-foreground'>{range}</span>
              </div>
              <p className='text-xs text-muted-foreground'>{detail}</p>
            </div>
          ))}
        </div>
        <div className='border border-border rounded-lg bg-card p-4 text-xs text-muted-foreground space-y-1'>
          <p className='font-medium text-foreground text-xs'>Test signal patterns</p>
          <p>
            Records are automatically flagged as <ScoreBadge tier='likely-test' /> when organization
            metadata matches common junk values such as <span className='font-mono bg-secondary rounded px-1'>test</span>,{' '}
            <span className='font-mono bg-secondary rounded px-1'>asdf</span>,{' '}
            <span className='font-mono bg-secondary rounded px-1'>lorem ipsum</span>,{' '}
            <span className='font-mono bg-secondary rounded px-1'>placeholder</span>, or when values are
            repeated, numeric-only, or made of repeated characters.
          </p>
        </div>
      </section>

      <section className='space-y-4'>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
          API endpoints
        </h2>
        <p className='text-sm text-muted-foreground'>
          The labeler exposes a small REST API for the dashboard as well as the standard AT Protocol
          labeler XRPC endpoint.
        </p>
        <div className='space-y-4'>
          {API_ENDPOINTS.map(({ method, path, description, curl }) => (
            <div key={path} className='border border-border rounded-lg bg-card p-4 space-y-3'>
              <div className='flex items-start gap-2 flex-wrap'>
                <span className='font-mono text-[10px] font-bold bg-primary text-primary-foreground rounded px-1.5 py-0.5 shrink-0'>
                  {method}
                </span>
                <span className='font-mono text-xs break-all'>{path}</span>
              </div>
              <p className='text-xs text-muted-foreground'>{description}</p>
              <div className='font-mono text-xs bg-secondary rounded-lg p-3 overflow-x-auto'>
                <pre className='whitespace-pre'>{curl}</pre>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className='space-y-4'>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
          AT Protocol integration
        </h2>
        <p className='text-sm text-muted-foreground'>
          Hyperlabel is a fully compliant AT Protocol labeler. Any app that supports the labeler
          protocol can subscribe to or query its labels.
        </p>
        <div className='border border-border rounded-lg bg-card p-4 space-y-3 text-sm'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <p className='text-xs font-medium font-[family-name:var(--font-syne)]'>Labeler DID</p>
              <p className='font-mono text-xs bg-secondary rounded px-2 py-1 break-all'>
                did:plc:5rw6of6lry7ihmyhm323ycwn
              </p>
            </div>
            <div className='space-y-1'>
              <p className='text-xs font-medium font-[family-name:var(--font-syne)]'>Handle</p>
              <p className='font-mono text-xs bg-secondary rounded px-2 py-1'>
                einstein.climateai.org
              </p>
            </div>
          </div>
        </div>
        <ul className='space-y-2 text-sm text-muted-foreground'>
          <li className='flex gap-2'>
            <span className='text-foreground shrink-0'>—</span>
            <span>
              Labels are served via the standard{' '}
              <span className='font-mono text-xs bg-secondary rounded px-1 py-0.5'>
                com.atproto.label.queryLabels
              </span>{' '}
              XRPC endpoint and can be queried by any AT Protocol client.
            </span>
          </li>
          <li className='flex gap-2'>
            <span className='text-foreground shrink-0'>—</span>
            <span>
              Each label is signed with ed25519 and includes: source DID, record URI, label value,
              timestamp, and a cryptographic signature.
            </span>
          </li>
          <li className='flex gap-2'>
            <span className='text-foreground shrink-0'>—</span>
            <span>
              Apps can subscribe to the labeler to automatically receive organization quality signals for
              app.certified.actor.organization records and filter or sort them by tier.
            </span>
          </li>
          <li className='flex gap-2'>
            <span className='text-foreground shrink-0'>—</span>
            <span>
              Only one quality label is active per record URI at a time. When a record is updated and
              re-scored, the previous label is negated before the new one is applied.
            </span>
          </li>
        </ul>
      </section>

    </div>
  )
}
