import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const LABELER_PORT = process.env.LABELER_PORT ? Number(process.env.LABELER_PORT) : 4100
const LABELER_ORIGIN = `http://127.0.0.1:${LABELER_PORT}`

async function proxyToLabeler(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const xrpcPath = path.join('/')
  const url = new URL(`/xrpc/${xrpcPath}`, LABELER_ORIGIN)

  // Preserve query params
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value)
  })

  try {
    const response = await fetch(url.toString(), {
      method: request.method,
      headers: {
        'accept': request.headers.get('accept') ?? 'application/json',
        ...(request.headers.get('content-type') ? { 'content-type': request.headers.get('content-type')! } : {}),
      },
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined,
    })

    const body = await response.arrayBuffer()

    return new NextResponse(body, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json',
        'access-control-allow-origin': '*',
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'LabelerServer unreachable', message: 'The internal labeler process is not running' },
      { status: 502 }
    )
  }
}

export const GET = proxyToLabeler
export const POST = proxyToLabeler
