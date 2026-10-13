import { TierBadge } from '@/components/TierBadge'

const getLabelerBaseUrl = () => (process.env.NEXT_PUBLIC_LABELER_ENDPOINT ?? '').replace(/\/$/, '')

const labelerUrl = (path: string) => {
  const baseUrl = getLabelerBaseUrl()
  return baseUrl ? `${baseUrl}${path}` : path
}

const ASSESSMENT_QUESTIONS = [
  {
    label: 'Test data',
    response: 'NOUL probability',
    description: 'Looks for contextual evidence that the actor or organization data is synthetic or intended for testing. Configured test-PDS hosts bypass Jev and receive the authoritative likely-test override.',
  },
  {
    label: 'Substantive purpose',
    response: 'NOUL probability',
    description: 'Checks whether the saved records establish a specific organizational mission or public purpose rather than a placeholder or generic claim.',
  },
  {
    label: 'Consistency and quality',
    response: 'Choice probabilities',
    description: 'Distinguishes high-quality, standard, and uncertain using specificity, internal consistency, and useful context. It does not verify identity or legitimacy.',
  },
]

const API_ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/stats',
    description: 'Dashboard statistics — monitored actors, published-tier counts, assessment status, stale labels, and 24h/7d actor updates.',
    curl: `curl "${labelerUrl('/api/stats')}"`,
  },
  {
    method: 'GET',
    path: '/api/recent?limit=20&offset=0&tier=all',
    description: 'Assessment feed with pagination, published-tier filtering, and text search (q=...). Entries expose assessment status, label freshness, model/question/policy versions, and current probabilities. Valid tier values: all, likely-test, standard, high-quality.',
    curl: `curl "${labelerUrl('/api/recent?limit=20&offset=0&tier=high-quality')}"`,
  },
  {
    method: 'GET',
    path: '/xrpc/com.atproto.label.queryLabels?uriPatterns=*',
    description: 'Query AT Protocol labels via the standard labeler endpoint. Use uriPatterns with a full URI, a trailing-prefix wildcard, or * for all labels; sources scopes the label source.',
    curl: `curl "${labelerUrl('/xrpc/com.atproto.label.queryLabels?uriPatterns=*')}"`,
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
          How the certified organization labeler merges profile and organization records, assesses them with Jev, and publishes quality labels against actor DIDs.
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
              { step: 'Assessed by Jev', sub: 'structured actor and URL evidence' },
              { step: 'Labeled', sub: 'signed label applied to the actor DID' },
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
              and streams live events with cryptographic verification. The labeler merges those records by DID
              so the dashboard can show the profile alongside the organization context. When a profile record needs
              fallback handling, the usable core fields are kept and malformed optional fields are ignored.
            </span>
          </li>
          <li className='flex gap-3'>
            <span className='font-[family-name:var(--font-syne)] font-bold text-foreground shrink-0'>2.</span>
            <span>
              Tap events update local record snapshots and queue a durable assessment job. The dashboard shows queued and waiting states while work is pending.
            </span>
          </li>
          <li className='flex gap-3'>
            <span className='font-[family-name:var(--font-syne)] font-bold text-foreground shrink-0'>3.</span>
            <span>
              Jev evaluates test-data evidence, substantive purpose, and consistency/quality from the saved profile and organization records plus URL status evidence. Configured <code className='font-mono text-xs'>TEST_PDS_HOSTS</code> take precedence and produce <TierBadge tier='likely-test' /> without a Jev call.
            </span>
          </li>
          <li className='flex gap-3'>
            <span className='font-[family-name:var(--font-syne)] font-bold text-foreground shrink-0'>4.</span>
            <span>
              Current standard or high-quality decisions are published as signed labels on the actor DID. Uncertain or unavailable results do not create new labels. Existing labels are retained and explicitly marked stale when their evidence changes.
            </span>
          </li>
        </ol>
      </section>

      <section className='space-y-4'>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
          Jev questions and evidence
        </h2>
        <p className='text-sm text-muted-foreground'>
          Jev receives the latest saved profile and organization records plus cached URL-resolution states in one structured request. Record strings are untrusted evidence, never instructions. The resulting label is a provisional content-quality signal, not identity, registration, or legitimacy verification.
        </p>
        <div className='border border-border rounded-lg bg-card overflow-hidden'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b border-border'>
                <th className='text-left px-4 py-2.5 text-xs font-medium text-muted-foreground font-[family-name:var(--font-syne)]'>Question</th>
                <th className='text-left px-4 py-2.5 text-xs font-medium text-muted-foreground font-[family-name:var(--font-syne)]'>Evidence considered</th>
                <th className='text-right px-4 py-2.5 text-xs font-medium text-muted-foreground font-[family-name:var(--font-syne)]'>Response</th>
              </tr>
            </thead>
            <tbody>
              {ASSESSMENT_QUESTIONS.map(({ label, response, description }, index) => (
                <tr key={label} className={index < ASSESSMENT_QUESTIONS.length - 1 ? 'border-b border-border' : ''}>
                  <td className='px-4 py-2.5 font-medium text-xs whitespace-nowrap'>{label}</td>
                  <td className='px-4 py-2.5 text-xs text-muted-foreground'>{description}</td>
                  <td className='px-4 py-2.5 text-right font-mono text-xs'>{response}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className='font-[family-name:var(--font-syne)] text-sm font-bold mt-4'>
          Uncertain and waiting states
        </h3>
        <p className='text-sm text-muted-foreground'>
          Configured test-PDS hosts are authoritative. Other test-data decisions come from Jev’s contextual assessment; incidental mentions of testing are not by themselves enough to mark an actor as test data.
        </p>
        <div className='border border-border rounded-lg bg-card p-4 text-xs text-muted-foreground space-y-1'>
          <p className='font-medium text-foreground text-xs'>Fallback and waiting behavior</p>
          <ul className='space-y-1 pl-3'>
            <li>• A host in configured <span className='font-mono bg-secondary rounded px-1'>TEST_PDS_HOSTS</span> receives the authoritative likely-test override without Jev.</li>
            <li>• A non-test actor without <span className='font-mono bg-secondary rounded px-1'>TYPESAFE_API_KEY</span> is saved and waits for configuration; it does not receive a new quality label.</li>
            <li>• Ambiguous or low-confidence Jev outcomes remain uncertain. Existing published labels are retained and marked stale where applicable.</li>
            <li>• Changes to saved records or URL-resolution evidence invalidate in-flight results; stale or deleted results are not published.</li>
          </ul>
        </div>
        <div className='border border-border rounded-lg bg-card p-4 text-xs text-muted-foreground space-y-1'>
          <p className='font-medium text-foreground text-xs'>Validation notes</p>
          <p>
            These informational notes are saved with usable profiles retained through fallback handling, for example when malformed optional avatar/banner media is dropped. Unusable profile payloads are not included in the assessment feed notes. They do not describe keyword, sparse-record, test-data, or Jev assessment checks.
          </p>
        </div>
      </section>

      <section className='space-y-4'>
        <h2 className='font-[family-name:var(--font-syne)] text-lg font-bold'>
          Quality tiers
        </h2>
        <p className='text-sm text-muted-foreground'>
          Published tier labels are discrete outcomes, not scores. Only a confident Jev decision or the configured test-PDS override produces a quality label. Uncertain, awaiting-configuration, and stale states are dashboard statuses, not label values.
        </p>
        <div className='grid gap-3 sm:grid-cols-2'>
          {[
            {
              tier: 'high-quality' as const,
              range: 'confident Jev choice',
              detail: 'Specific, coherent organizational purpose with substantial useful context. This is not identity or legitimacy verification.',
            },
            {
              tier: 'standard' as const,
              range: 'confident Jev choice',
              detail: 'A substantive, coherent organization context that is less detailed than the high-quality rubric.',
            },
            {
              tier: 'likely-test' as const,
              range: 'test-PDS policy or confident test decision',
              detail: 'A configured test PDS is authoritative; Jev can also detect contextual evidence of synthetic or test data.',
            },
          ].map(({ tier, range, detail }) => (
            <div key={tier} className='border border-border rounded-lg bg-card p-4 space-y-2'>
              <div className='flex items-center justify-between gap-2'>
                <TierBadge tier={tier} />
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
          The public REST API provides dashboard statistics and assessment status; the standard AT Protocol labeler XRPC endpoint serves signed quality labels. REST assessment details can be stale or uncertain and must not be treated as published label state.
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
        <p className='text-sm text-muted-foreground'>
          Admins sign in at /admin through AT Protocol OAuth. The confidential client requests only the atproto scope, and only a verified DID in ADMIN_DIDS receives a local session; mutations remain protected by origin and CSRF checks. Configure ADMIN_ORIGIN plus the OAuth signing and encryption keys before enabling admin access. Reassessment requires explicit confirmation and shows run progress; there is no password fallback.
        </p>
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
              Each signed label includes: source DID, subject DID, label value, timestamp,
              and a cryptographic signature.
            </span>
          </li>
          <li className='flex gap-2'>
            <span className='text-foreground shrink-0'>—</span>
            <span>
              Apps can subscribe to the labeler to automatically receive organization quality signals for
              actor DIDs and filter or sort them by tier. The related profile and organization records are
              used for merged actor context, not as the label target.
            </span>
          </li>
          <li className='flex gap-2'>
            <span className='text-foreground shrink-0'>—</span>
            <span>
              Only one quality label is active per actor DID at a time. When a current assessment changes the published tier, the previous label is negated before the new one is applied.
            </span>
          </li>
        </ul>
      </section>

    </div>
  )
}
