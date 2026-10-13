import { NextResponse } from 'next/server'
import { authorizeAdminRequest } from '@/lib/admin-auth'
import {
  getActiveReassessmentRun,
  getReassessmentRun,
  startReassessmentRun,
} from '@/lib/db'

function authorizationResponse(result: Exclude<ReturnType<typeof authorizeAdminRequest>, { ok: true }>) {
  return NextResponse.json({ error: result.code }, { status: result.status })
}

export async function GET(request: Request) {
  const authorization = authorizeAdminRequest(request)
  if (!authorization.ok) return authorizationResponse(authorization)

  const runId = new URL(request.url).searchParams.get('runId')
  if (runId && !/^[0-9a-f-]{36}$/i.test(runId)) {
    return NextResponse.json({ error: 'invalid_run_id' }, { status: 400 })
  }

  const run = runId ? getReassessmentRun(runId) : getActiveReassessmentRun()
  if (runId && !run) return NextResponse.json({ error: 'run_not_found' }, { status: 404 })
  return NextResponse.json({ run })
}

export async function POST(request: Request) {
  const authorization = authorizeAdminRequest(request, { mutation: true })
  if (!authorization.ok) return authorizationResponse(authorization)

  try {
    const result = startReassessmentRun(authorization.session.did)
    return NextResponse.json(
      { run: result.run },
      { status: result.started ? 202 : 409 },
    )
  } catch {
    return NextResponse.json({ error: 'reassessment_start_failed' }, { status: 500 })
  }
}
