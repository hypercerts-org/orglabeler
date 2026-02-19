'use client'

import { ScoreBadge } from '@/components/ScoreBadge'

const SCORING_CRITERIA = [
  { label: 'Title quality', points: 15, description: 'Meaningful, descriptive title' },
  { label: 'Summary quality', points: 15, description: 'Clear short description' },
  { label: 'Description quality', points: 20, description: 'Detailed description with sufficient length' },
  { label: 'Image', points: 10, description: 'Has an attached image' },
  { label: 'Work scope', points: 10, description: 'Defines work scope tags' },
  { label: 'Contributors', points: 15, description: 'Lists contributors with weights and details' },
  { label: 'Locations', points: 5, description: 'Has geographic locations' },
  { label: 'Date range', points: 5, description: 'Specifies start and end dates' },
  { label: 'Rights', points: 5, description: 'Defines usage rights' },
]

const API_ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/stats',
    description: 'Dashboard statistics — total counts, tier breakdown, 24h/7d activity.',
    curl: `curl https://hyperlabel-production.up.railway.app/api/stats`,
  },
  {
    method: 'GET',
    path: '/api/recent?limit=20&offset=0&tier=all',
    description: 'Recent activities with pagination and optional tier filtering. Valid tier values: all, pending, high-quality, standard, draft, likely-test.',
    curl: `curl "https://hyperlabel-production.up.railway.app/api/recent?limit=20&offset=0&tier=high-quality"`,
  },
  {
    method: 'GET',
    path: '/xrpc/com.atproto.label.queryLabels?uriPatterns=did:plc:*',
    description: 'Query AT Protocol labels via the standard labeler endpoint. Supports uriPatterns and sources query params.',
    curl: `curl "https://hyperlabel-production.up.railway.app/xrpc/com.atproto.label.queryLabels?uriPatterns=did:plc:*"`,
  },
]

export default function DocsPage() {
  return (
    <div className='py-8 space-y-10 animate-fade-in-up'>

      {/* Header */}
      <div>
        <h1 className='font-[family-name:var(--font-syne)] text-2xl font-bold'>
          Documentation
        </h1>
        <p className='text-sm text-muted-foreground mt-1'>
          How Hyperlabel scores and labels hypercert activity records.
        </p>
      </div>

      {/* How it works */}
      <section className='space-y-4'>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
          How it works
        </h2>

        {/* Pipeline visualization */}
        <div className='border border-border rounded-lg bg-card p-4 overflow-x-auto'>
          <div className='flex items-center gap-2 min-w-max'>
            {[
              { step: 'Record Created', sub: 'on AT Protocol' },
              { step: 'Detected', sub: 'via Tap' },
              { step: 'Scored', sub: '9 criteria' },
              { step: 'Labeled', sub: 'signed label applied' },
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
              <span className='font-mono text-xs bg-secondary rounded px-1 py-0.5'>org.hypercerts.claim.activity</span>{' '}
              records. Tap automatically discovers repos, backfills historical records from each PDS,
              and streams live events with cryptographic verification. This means records created
              before the labeler started are still scored.
            </span>
          </li>
          <li className='flex gap-3'>
            <span className='font-[family-name:var(--font-syne)] font-bold text-foreground shrink-0'>2.</span>
            <span>
              When a record is detected it is immediately written to the activity log and appears in the
              dashboard with a <ScoreBadge tier='pending' /> label while evaluation is in progress.
            </span>
          </li>
          <li className='flex gap-3'>
            <span className='font-[family-name:var(--font-syne)] font-bold text-foreground shrink-0'>3.</span>
            <span>
              The scoring engine evaluates the record against 9 quality criteria worth 100 points in total.
              Test signals are checked first — any record that looks like placeholder data is flagged
              immediately regardless of its numeric score.
            </span>
          </li>
          <li className='flex gap-3'>
            <span className='font-[family-name:var(--font-syne)] font-bold text-foreground shrink-0'>4.</span>
            <span>
              A signed AT Protocol label is applied to the author&apos;s DID based on the score tier.
              The pending label is negated and replaced with the final quality label.
            </span>
          </li>
        </ol>
      </section>

      {/* Scoring criteria */}
      <section className='space-y-4'>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
          Scoring criteria
        </h2>
        <p className='text-sm text-muted-foreground'>
          Each record is evaluated on 9 criteria for a maximum of 100 points.
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
      </section>

      {/* Quality tiers */}
      <section className='space-y-4'>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
          Quality tiers
        </h2>
        <p className='text-sm text-muted-foreground'>
          Scores map to four tiers. Test signals override the numeric score and always produce a
          &ldquo;Likely Test&rdquo; label.
        </p>
        <div className='grid gap-3 sm:grid-cols-2'>
          {[
            {
              tier: 'high-quality' as const,
              range: '70 – 100',
              detail: 'Well-documented record with comprehensive activity details.',
            },
            {
              tier: 'standard' as const,
              range: '40 – 69',
              detail: 'Adequate record with basic activity information filled in.',
            },
            {
              tier: 'draft' as const,
              range: '15 – 39',
              detail: 'Minimal record — appears to be a work in progress.',
            },
            {
              tier: 'likely-test' as const,
              range: '0 – 14 or test signals',
              detail: 'Contains test or placeholder data (e.g. "Test", "asdf", lorem ipsum, repeated characters).',
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
            Records are automatically flagged as <ScoreBadge tier='likely-test' /> when the title or
            summary matches patterns such as: <span className='font-mono bg-secondary rounded px-1'>test</span>,{' '}
            <span className='font-mono bg-secondary rounded px-1'>asdf</span>,{' '}
            <span className='font-mono bg-secondary rounded px-1'>lorem ipsum</span>,{' '}
            <span className='font-mono bg-secondary rounded px-1'>untitled</span>,{' '}
            <span className='font-mono bg-secondary rounded px-1'>aaaa…</span>, or when the title is
            identical to the summary and fewer than 50 characters.
          </p>
        </div>
      </section>

      {/* API endpoints */}
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

      {/* AT Protocol integration */}
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
              Each label is signed with ed25519 and includes: source DID, target DID, label value,
              timestamp, and a cryptographic signature.
            </span>
          </li>
          <li className='flex gap-2'>
            <span className='text-foreground shrink-0'>—</span>
            <span>
              Apps can subscribe to the labeler to automatically receive quality signals for
              hypercert activity records and filter or sort them by tier.
            </span>
          </li>
          <li className='flex gap-2'>
            <span className='text-foreground shrink-0'>—</span>
            <span>
              Only one quality label is active per DID at a time. When a record is updated and
              re-scored, the previous label is negated before the new one is applied.
            </span>
          </li>
        </ul>
      </section>

    </div>
  )
}
