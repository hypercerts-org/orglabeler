'use client'

import { ScoreBadge } from '@/components/ScoreBadge'
import { COMPLETENESS_WEIGHTS } from '@/lib/constants'

const LABELER_BASE_URL = (process.env.NEXT_PUBLIC_LABELER_ENDPOINT ?? '').replace(/\/$/, '')

const labelerUrl = (path: string) => {
  return LABELER_BASE_URL ? `${LABELER_BASE_URL}${path}` : path
}

const SCORING_CRITERIA = [
  {
    label: 'Display name',
    points: COMPLETENESS_WEIGHTS.displayName,
    description: 'Awards a small amount when the display name comes from profile data or organization type instead of the DID-derived fallback.',
  },
  {
    label: 'Description',
    points: COMPLETENESS_WEIGHTS.description,
    description: 'Awards points when the profile description is present and not obvious test data.',
  },
  {
    label: 'Organization type',
    points: COMPLETENESS_WEIGHTS.organizationType,
    description: 'Awards partial points for only `other`, full points for a specific organization type.',
  },
  {
    label: 'Profile website present',
    points: COMPLETENESS_WEIGHTS.websitePresent,
    description: 'Awards points when profile.website is filled in.',
  },
  {
    label: 'Profile website resolves',
    points: COMPLETENESS_WEIGHTS.websiteResolves,
    description: 'Awards stronger points when profile.website is a valid public HTTP(S) URL.',
  },
  {
    label: 'Profile website matches name',
    points: COMPLETENESS_WEIGHTS.websiteMatchesName,
    description: 'Awards a small amount when the display name matches the profile.website domain stem.',
  },
  {
    label: 'Organization URLs (small bonus)',
    points: COMPLETENESS_WEIGHTS.organizationUrlsPresent,
    description: 'Awards a small amount when the organization has at least one URL.',
  },
  {
    label: 'Organization URLs resolve',
    points: COMPLETENESS_WEIGHTS.organizationUrlsResolve,
    description: 'Awards a small amount when at least one organization URL is a valid public HTTP(S) URL.',
  },
  {
    label: 'Location valid',
    points: COMPLETENESS_WEIGHTS.locationValid,
    description: 'Awards stronger points when the location is a valid certified location reference.',
  },
  {
    label: 'Founded date valid',
    points: COMPLETENESS_WEIGHTS.foundedDateValid,
    description: 'Awards points for a valid, non-future foundedDate.',
  },
  {
    label: 'Founded date age bonus',
    points: COMPLETENESS_WEIGHTS.foundedDateAge,
    description: 'Awards bonus points when the founded date is at least a year old.',
  },
  {
    label: 'Avatar',
    points: COMPLETENESS_WEIGHTS.avatar,
    description: 'Awards meaningful points when the profile has an avatar.',
  },
  {
    label: 'Banner',
    points: COMPLETENESS_WEIGHTS.banner,
    description: 'Awards meaningful points when the profile has a banner.',
  },
]

const API_ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/stats',
    description: 'Dashboard statistics — total records, tier breakdown, 24h/7d record counts.',
    curl: 'curl /api/stats',
  },
  {
    method: 'GET',
    path: '/api/recent?limit=20&offset=0&tier=all',
    description: 'Recent organization records with pagination, tier filtering, AI-only filtering (hf=true), and text search (q=...). Valid tier values: all, likely-test, standard, high-quality.',
    curl: 'curl "/api/recent?limit=20&offset=0&tier=high-quality"',
  },
  {
    method: 'GET',
    path: '/xrpc/com.atproto.label.queryLabels?uriPatterns=at://did:plc:*/app.certified.actor.organization/*',
    description: 'Query AT Protocol labels via the standard labeler endpoint. Use uriPatterns to filter record URIs and sources to scope the label source.',
    curl: `curl "${labelerUrl('/xrpc/com.atproto.label.queryLabels?uriPatterns=at://did:plc:*/app.certified.actor.organization/*')}"`,
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
          How the certified organization labeler merges profile and organization records, then scores and labels the organization record on AT Protocol.
        </p>
      </div>

      <section className='space-y-4'>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
          How it works
        </h2>

        <div className='border border-border rounded-lg bg-card p-4 overflow-x-auto'>
          <div className='flex items-center gap-2 min-w-max'>
            {[
              { step: 'Profile + Organization Records', sub: 'collected together by Tap' },
              { step: 'Merged by DID', sub: 'for actor context' },
              { step: 'Scored', sub: 'merged profile + organization context' },
              { step: 'Labeled', sub: 'signed label applied to the organization record URI' },
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
              The certified organization labeler uses{' '}
              <span className='font-mono text-xs bg-secondary rounded px-1 py-0.5'>Tap</span>{' '}
              — Bluesky&apos;s official sync tool — to monitor the AT Protocol network for both{' '}
              <span className='font-mono text-xs bg-secondary rounded px-1 py-0.5'>app.certified.actor.profile</span>{' '}
              and{' '}
              <span className='font-mono text-xs bg-secondary rounded px-1 py-0.5'>app.certified.actor.organization</span>{' '}
              records. Tap automatically discovers repos, backfills historical records from each PDS,
              and streams live events with cryptographic verification. The sidecar merges those records by DID
              so the dashboard can show the profile alongside the organization context. When a profile record needs
              fallback handling, the usable core fields are kept and malformed optional fields are ignored.
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
              The scoring engine checks an authenticity gate first. Records with authenticity failures are labeled
              <ScoreBadge tier='likely-test' /> before completeness scoring begins. Validation notes are shown
              separately and do not affect tiering. Passing records then receive the 100-point completeness score.
            </span>
          </li>
          <li className='flex gap-3'>
            <span className='font-[family-name:var(--font-syne)] font-bold text-foreground shrink-0'>4.</span>
            <span>
              A signed AT Protocol label is applied to the organization record URI based on the score tier.
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
          Each passing organization record is evaluated on 13 completeness criteria for a maximum of 100 points. The
          rubric now gives less credit to basic identity fields and more weight to harder-to-fake credibility signals
          like website resolution, location, and visual/profile completeness. The authenticity gate runs first,
          validation notes are informational only, and labels stay attached to the organization record URI.
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
          Authenticity gate
        </h3>
        <p className='text-sm text-muted-foreground'>
          Matching any gate failure forces <ScoreBadge tier='likely-test' />. These are authenticity failures, not
          validation notes, and there are no separate numeric deductions.
        </p>
        <div className='border border-border rounded-lg bg-card p-4 text-xs text-muted-foreground space-y-1'>
          <p className='font-medium text-foreground text-xs'>Authenticity gate failure patterns</p>
          <ul className='space-y-1 pl-3'>
            <li>• Common junk values: <span className='font-mono bg-secondary rounded px-1'>test</span>, <span className='font-mono bg-secondary rounded px-1'>asdf</span>, <span className='font-mono bg-secondary rounded px-1'>lorem ipsum</span>, <span className='font-mono bg-secondary rounded px-1'>placeholder</span>, <span className='font-mono bg-secondary rounded px-1'>delete me</span>, <span className='font-mono bg-secondary rounded px-1'>ignore</span>, <span className='font-mono bg-secondary rounded px-1'>todo</span>, <span className='font-mono bg-secondary rounded px-1'>foo</span>, <span className='font-mono bg-secondary rounded px-1'>bar</span>, <span className='font-mono bg-secondary rounded px-1'>abc</span>, <span className='font-mono bg-secondary rounded px-1'>wip</span>, <span className='font-mono bg-secondary rounded px-1'>sample</span>, and <span className='font-mono bg-secondary rounded px-1'>example</span>.</li>
            <li>• Empty-style values: <span className='font-mono bg-secondary rounded px-1'>n/a</span>, <span className='font-mono bg-secondary rounded px-1'>none</span>, <span className='font-mono bg-secondary rounded px-1'>null</span>, <span className='font-mono bg-secondary rounded px-1'>undefined</span>, <span className='font-mono bg-secondary rounded px-1'>blank</span>, <span className='font-mono bg-secondary rounded px-1'>draft</span>, <span className='font-mono bg-secondary rounded px-1'>temp</span>, and <span className='font-mono bg-secondary rounded px-1'>tmp</span>.</li>
            <li>• Single-word greetings, repeated characters, and numeric-only values are also treated as test data.</li>
          </ul>
        </div>
        <div className='border border-border rounded-lg bg-card p-4 text-xs text-muted-foreground space-y-1'>
          <p className='font-medium text-foreground text-xs'>Validation notes</p>
          <p>
            These are informational only. They can appear when fallback handling keeps usable profile fields and
            drops malformed optional fields, and they do not imply suspicious activity or affect tiering.
          </p>
        </div>
      </section>

      <section className='space-y-4'>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
          Quality tiers
        </h2>
        <p className='text-sm text-muted-foreground'>
          Scores map to three tiers. Authenticity gate failures override the numeric score and always produce a
          <ScoreBadge tier='likely-test' /> label. Validation notes do not change the tier.
        </p>
        <div className='grid gap-3 sm:grid-cols-2'>
          {[
            {
              tier: 'high-quality' as const,
              range: '75 – 100',
              detail: 'Strong merged profile + organization record with broad completeness across the rubric.',
            },
            {
              tier: 'standard' as const,
              range: '45 – 74',
              detail: 'Decent merged record with some useful metadata, but not full rubric coverage.',
            },
            {
              tier: 'likely-test' as const,
              range: '0 – 44 or gate failures',
              detail: 'Contains authenticity gate failures, or falls below the standard threshold.',
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
      </section>

      <section className='space-y-4'>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
          API endpoints
        </h2>
        <p className='text-sm text-muted-foreground'>
          The certified organization labeler exposes a small REST API for the dashboard as well as the standard AT Protocol
          labeler XRPC endpoint. Labels are still published against the organization record URI.
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
          The certified organization labeler is a fully compliant AT Protocol labeler. Any app that supports the labeler
          protocol can subscribe to or query its labels.
        </p>
        <div className='border border-border rounded-lg bg-card p-4 space-y-3 text-sm'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <p className='text-xs font-medium font-[family-name:var(--font-syne)]'>Labeler DID</p>
              <p className='font-mono text-xs bg-secondary rounded px-2 py-1 break-all'>
                did:plc:pswneepkd5lesumj7ejmkbal
              </p>
            </div>
            <div className='space-y-1'>
              <p className='text-xs font-medium font-[family-name:var(--font-syne)]'>Handle</p>
              <p className='font-mono text-xs bg-secondary rounded px-2 py-1'>
                orglabeler.certified.one
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
              app.certified.actor.organization records and filter or sort them by tier. The related profile record is
              used for merged actor context, not for the label target.
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
