import Link from 'next/link'
import { cookies } from 'next/headers'
import { AdminReassessmentPanel } from '@/components/AdminReassessmentPanel'
import { ADMIN_DIDS_CONFIG, ADMIN_ORIGIN } from '@/lib/config'
import { getAdminOAuthClient, getAdminOAuthConfigurationIssue } from '@/lib/admin-oauth'
import { getAdminPageSession } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ login?: string }>
}) {
  const cookieStore = await cookies()
  const cookieHeader = cookieStore.getAll().map(({ name, value }) => `${name}=${value}`).join('; ')
  const session = getAdminPageSession(cookieHeader)
  let configurationIssue = getAdminOAuthConfigurationIssue()
  if (!configurationIssue) {
    try {
      await getAdminOAuthClient()
    } catch (error) {
      configurationIssue = error instanceof Error ? error.message : 'OAuth configuration is invalid.'
    }
  }
  const { login } = await searchParams
  const authConfigured = ADMIN_DIDS_CONFIG.error === null && ADMIN_ORIGIN !== null && configurationIssue === null
  const loginMessage = login === 'not-allowed'
    ? 'That account DID is not on the configured admin allowlist.'
    : login === 'identity'
      ? 'The submitted handle or DID could not be verified. Check it and try again.'
      : login === 'invalid'
        ? 'Enter a valid AT Protocol handle or DID.'
        : login === 'configuration'
          ? 'Admin OAuth is not configured. Check the required server settings below.'
          : login === 'failed'
            ? 'Sign-in did not complete. The state may have expired or the provider rejected the request; start again.'
            : null

  return (
    <div className='mx-auto max-w-3xl space-y-6 py-8'>
      <div>
        <p className='font-mono text-[10px] uppercase tracking-[0.16em] text-primary'>Private controls</p>
        <h1 className='mt-2 font-[family-name:var(--font-syne)] text-2xl font-bold'>OrgLabeler admin</h1>
      </div>

      {!authConfigured ? (
        <section className='rounded-lg border border-border bg-card p-5'>
          <p className='font-medium'>Admin access is not configured.</p>
          <p className='mt-2 text-sm text-muted-foreground'>{configurationIssue ?? 'Set a valid ADMIN_DIDS allowlist and exact ADMIN_ORIGIN.'}</p>
          <p className='mt-2 text-sm text-muted-foreground'>OAuth metadata and protected admin routes remain unavailable until configuration is valid.</p>
        </section>
      ) : !session ? (
        <section className='space-y-4 rounded-lg border border-border bg-card p-5'>
          <div>
            <p className='font-medium'>Sign in with an allowlisted AT Protocol account.</p>
            <p className='mt-2 text-sm text-muted-foreground'>Only a verified DID in ADMIN_DIDS can receive an admin session. No repository, blob, account, or transition permissions are requested.</p>
          </div>
          {loginMessage && <p role='alert' className='text-sm text-rose-600 dark:text-rose-400'>{loginMessage}</p>}
          <form action='/api/admin/oauth/login' method='post' className='space-y-3'>
            <label htmlFor='identifier' className='block text-sm font-medium'>AT Protocol handle or DID</label>
            <input
              id='identifier'
              name='identifier'
              type='text'
              autoComplete='username'
              autoCapitalize='none'
              spellCheck={false}
              maxLength={253}
              required
              placeholder='you.example or did:plc:…'
              className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
            />
            <button type='submit' className='rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground'>
              Continue with AT Protocol
            </button>
          </form>
        </section>
      ) : (
        <AdminReassessmentPanel did={session.did} csrfToken={session.csrfToken} />
      )}

      <Link href='/' className='inline-block text-sm text-muted-foreground hover:text-foreground'>
        ← Public dashboard
      </Link>
    </div>
  )
}
