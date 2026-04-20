export type LinkResolutionMethod = 'HEAD' | 'GET'

export type LinkResolutionReason = 'ok' | 'invalid-url' | 'timeout' | 'network-error' | 'http-error'

export interface LinkResolutionResult {
  input: string
  normalizedUrl: string | null
  resolvable: boolean
  reason: LinkResolutionReason
  method: LinkResolutionMethod | null
  status: number | null
  statusText: string | null
  finalUrl: string | null
  error: string | null
}

const DEFAULT_TIMEOUT_MS = 2500
const UNSUPPORTED_HEAD_STATUSES = new Set([405, 501])

function normalizeUrlInput(url: string): string {
  return url.trim()
}

function createResult(params: {
  input: string
  normalizedUrl: string | null
  resolvable: boolean
  reason: LinkResolutionReason
  method: LinkResolutionMethod | null
  status?: number | null
  statusText?: string | null
  finalUrl?: string | null
  error?: string | null
}): LinkResolutionResult {
  return {
    input: params.input,
    normalizedUrl: params.normalizedUrl,
    resolvable: params.resolvable,
    reason: params.reason,
    method: params.method,
    status: params.status ?? null,
    statusText: params.statusText ?? null,
    finalUrl: params.finalUrl ?? null,
    error: params.error ?? null,
  }
}

function isResolvableStatus(status: number): boolean {
  return status >= 200 && status < 400
}

async function requestUrl(url: string, method: LinkResolutionMethod, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store',
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function tryMethod(url: string, method: LinkResolutionMethod, timeoutMs: number): Promise<LinkResolutionResult> {
  try {
    const response = await requestUrl(url, method, timeoutMs)

    if (isResolvableStatus(response.status)) {
      return createResult({
        input: url,
        normalizedUrl: url,
        resolvable: true,
        reason: 'ok',
        method,
        status: response.status,
        statusText: response.statusText,
        finalUrl: response.url || url,
      })
    }

    return createResult({
      input: url,
      normalizedUrl: url,
      resolvable: false,
      reason: 'http-error',
      method,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url || url,
      error: `HTTP ${response.status}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const reason = message.toLowerCase().includes('aborted') ? 'timeout' : 'network-error'

    return createResult({
      input: url,
      normalizedUrl: url,
      resolvable: false,
      reason,
      method,
      error: message,
    })
  }
}

export async function resolvePublicUrl(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<LinkResolutionResult> {
  const normalizedUrl = normalizeUrlInput(url)

  if (!normalizedUrl) {
    return createResult({
      input: url,
      normalizedUrl: null,
      resolvable: false,
      reason: 'invalid-url',
      method: null,
      error: 'URL is empty',
    })
  }

  try {
    const parsed = new URL(normalizedUrl)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return createResult({
        input: url,
        normalizedUrl: null,
        resolvable: false,
        reason: 'invalid-url',
        method: null,
        error: `Unsupported protocol: ${parsed.protocol}`,
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid URL'

    return createResult({
      input: url,
      normalizedUrl: null,
      resolvable: false,
      reason: 'invalid-url',
      method: null,
      error: message,
    })
  }

  const headResult = await tryMethod(normalizedUrl, 'HEAD', timeoutMs)

  if (headResult.resolvable) {
    return headResult
  }

  if (headResult.reason === 'timeout' || headResult.reason === 'network-error') {
    return headResult
  }

  if (headResult.status !== null && !UNSUPPORTED_HEAD_STATUSES.has(headResult.status)) {
    return headResult
  }

  const getResult = await tryMethod(normalizedUrl, 'GET', timeoutMs)

  if (getResult.resolvable) {
    return getResult
  }

  return getResult
}
