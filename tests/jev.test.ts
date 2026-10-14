import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchJevAssessment } from '../src/lib/jev'
import type { JevAssessmentState, JevFetch } from '../src/lib/jev'

const state: JevAssessmentState = {
  did: 'did:example:forest',
  displayName: 'Forest Recovery Collective',
  profileRecord: {
    displayName: 'Forest Recovery Collective',
    description: 'Restoring native forests with local communities.',
    website: 'https://forest.example.org',
  },
  organizationRecord: {
    $type: 'app.certified.actor.organization',
    organizationType: ['nonprofit'],
    urls: [{ label: 'Project site', url: 'https://forest.example.org/projects' }],
  },
  urlEvidence: [
    { source: 'profile.website', url: 'https://forest.example.org', status: 'ok' },
    { source: 'organization.urls[0]', url: 'https://forest.example.org/projects', status: 'unknown' },
  ],
}

function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: 'jev-1.13.0',
    answers: {
      test_data: { type: 'noul', noul: 0.01 },
      substantive_purpose: { type: 'noul', noul: 0.98 },
      consistency_quality: {
        type: 'choice',
        choice: 'high_quality',
        confidence: 0.97,
        probabilities: { high_quality: 0.97, standard: 0.02, uncertain: 0.01 },
      },
    },
    usage: { input_tokens: 220, output_tokens: 27 },
    ...overrides,
  }
}

function okFetch(body: unknown, capture: (url: string, init: RequestInit) => void): JevFetch {
  return async (url, init) => {
    capture(url, init)
    return new Response(JSON.stringify(body), { status: 200 })
  }
}

test('Jev adapter sends structured merged records and URL evidence in one request', async () => {
  let requestUrl = ''
  let requestInit: RequestInit | undefined
  const fetchImpl = okFetch(response(), (url, init) => {
    requestUrl = url
    requestInit = init
  })

  const result = await fetchJevAssessment(state, {
    apiKey: 'test-key',
    model: 'jev-latest',
    fetchImpl,
  })

  assert.equal(requestUrl, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(new Headers(requestInit?.headers).get('authorization'), 'Bearer test-key')
  assert.equal(new Headers(requestInit?.headers).get('content-type'), 'application/json')

  const payload = JSON.parse(String(requestInit?.body)) as {
    model: string
    state: Record<string, unknown>
    questions: Record<string, { type: string; instructions?: string; criteria?: Record<string, string> }>
  }
  assert.equal(payload.model, 'jev-latest')
  assert.deepEqual(payload.state.source_records, {
    profile: state.profileRecord,
    organization: state.organizationRecord,
  })
  assert.deepEqual(payload.state.url_evidence, state.urlEvidence)
  assert.equal(typeof payload.state, 'object')
  assert.equal(Object.keys(payload.questions).length, 3)
  assert.ok(Object.values(payload.questions).every(question => question.instructions?.includes('untrusted') ?? false))
  assert.equal(result.model, 'jev-1.13.0')
  assert.deepEqual(result.decision, { kind: 'label', tier: 'high-quality' })
  assert.deepEqual(result.usage, { input_tokens: 220, output_tokens: 27 })
})

test('Jev adapter refuses to call the provider without an API key', async () => {
  let called = false
  const fetchImpl: JevFetch = async () => {
    called = true
    return new Response('{}', { status: 200 })
  }

  await assert.rejects(
    fetchJevAssessment(state, { apiKey: '', fetchImpl }),
    /TYPESAFE_API_KEY is not configured/,
  )
  assert.equal(called, false)
})

test('provider failures surface as retryable errors without exposing response bodies', async () => {
  let callCount = 0
  const fetchImpl: JevFetch = async () => {
    callCount++
    return new Response('private provider response', { status: 503 })
  }

  await assert.rejects(
    fetchJevAssessment(state, { apiKey: 'test-key', fetchImpl }),
    error => error instanceof Error && /HTTP 503/.test(error.message) && !error.message.includes('private provider response'),
  )
  assert.equal(callCount, 1)
})

test('provider timeout aborts the request within the configured budget', async () => {
  const fetchImpl: JevFetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  })

  await assert.rejects(
    fetchJevAssessment(state, { apiKey: 'test-key', timeoutMs: 5, fetchImpl }),
    /timed out after 5ms/,
  )
})

test('provider timeout covers a stalled response body and reports a timeout', async () => {
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
  const fetchImpl: JevFetch = async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      bodyController = controller
      init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true })
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  const guard = setTimeout(() => bodyController?.error(new Error('test guard expired')), 100)
  try {
    await assert.rejects(
      fetchJevAssessment(state, { apiKey: 'test-key', timeoutMs: 5, fetchImpl }),
      /timed out after 5ms/,
    )
  } finally {
    clearTimeout(guard)
  }
})

test('uncertain Jev outputs remain uncertain instead of becoming standard', async () => {
  const lowQualityConfidence = response({
    answers: {
      test_data: { type: 'noul', noul: 0.01 },
      substantive_purpose: { type: 'noul', noul: 0.98 },
      consistency_quality: {
        type: 'choice',
        choice: 'standard',
        confidence: 0.8,
        probabilities: { high_quality: 0.1, standard: 0.8, uncertain: 0.1 },
      },
    },
  })
  const uncertainTestProbability = response({
    answers: {
      test_data: { type: 'noul', noul: 0.15 },
      substantive_purpose: { type: 'noul', noul: 0.98 },
      consistency_quality: {
        type: 'choice',
        choice: 'high_quality',
        confidence: 0.99,
        probabilities: { high_quality: 0.99, standard: 0.005, uncertain: 0.005 },
      },
    },
  })

  for (const uncertain of [lowQualityConfidence, uncertainTestProbability]) {
    const result = await fetchJevAssessment(state, {
      apiKey: 'test-key',
      fetchImpl: okFetch(uncertain, () => {}),
    })
    assert.deepEqual(result.decision, { kind: 'uncertain' })
  }
})

test('high test probability is a likely-test decision, while malformed replies are rejected', async () => {
  const likelyTest = response({
    answers: {
      test_data: { type: 'noul', noul: 0.99 },
      substantive_purpose: { type: 'noul', noul: 0.98 },
      consistency_quality: {
        type: 'choice',
        choice: 'high_quality',
        confidence: 0.97,
        probabilities: { high_quality: 0.97, standard: 0.02, uncertain: 0.01 },
      },
    },
  })
  const testResult = await fetchJevAssessment(state, {
    apiKey: 'test-key',
    fetchImpl: okFetch(likelyTest, () => {}),
  })
  assert.deepEqual(testResult.decision, { kind: 'label', tier: 'likely-test' })

  const malformedReplies = [
    response({ answers: { test_data: { type: 'noul', noul: 0.01 } } }),
    response({
      answers: {
        ...response().answers as Record<string, unknown>,
        consistency_quality: {
          type: 'choice',
          choice: 'standard',
          confidence: 0.8,
          probabilities: { high_quality: 0.7, standard: 0.2, uncertain: 0.1 },
        },
      },
    }),
    response({ usage: { input_tokens: -1, output_tokens: 2 } }),
  ]

  for (const malformed of malformedReplies) {
    await assert.rejects(
      fetchJevAssessment(state, { apiKey: 'test-key', fetchImpl: okFetch(malformed, () => {}) }),
      /malformed|probabilit|usage/i,
    )
  }
})
