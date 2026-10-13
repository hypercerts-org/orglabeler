import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const did = 'did:example:policy-identity'
const baseline: Record<string, string> = {
  DID: 'did:example:labeler',
  SIGNING_KEY: '01'.repeat(32),
  TYPESAFE_API_KEY: 'test-key',
  JEV_MODEL: 'jev-test-model',
  JEV_TEST_THRESHOLD: '0.98',
  JEV_MAX_TEST_PROBABILITY_FOR_QUALITY: '0.02',
  JEV_PURPOSE_THRESHOLD: '0.95',
  JEV_QUALITY_THRESHOLD: '0.95',
  TEST_PDS_HOSTS: 'test-one.example',
  URL_ENRICHMENT_ENABLED: 'false',
}

const workerScript = `
import * as db from ${JSON.stringify(pathToFileURL(join(repoRoot, 'src/lib/db.ts')).href)}
import * as worker from ${JSON.stringify(pathToFileURL(join(repoRoot, 'src/labeler/jev-assessment-worker.ts')).href)}

const did = ${JSON.stringify(did)}
if (process.env.POLICY_ACTION === 'seed') {
  const rkey = 'self'
  const uri = 'at://' + did + '/app.certified.actor.organization/' + rkey
  db.upsertOrganizationSnapshot({
    did,
    rkey,
    recordUri: uri,
    payload: {
      $type: 'app.certified.actor.organization',
      organizationType: ['nonprofit'],
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  })
  db.upsertProfileSnapshot({
    did,
    rkey: 'self',
    recordUri: 'at://' + did + '/app.certified.actor.profile/self',
    payload: {
      $type: 'app.certified.actor.profile',
      displayName: 'Forest Recovery Collective',
      description: 'Restoring native forests with local communities.',
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  })
  db.recordActorPdsOk(did, 'https://pds.safe.example', 'pds.safe.example', 60000)
  const providerBody = {
    model: 'jev-test-model',
    answers: {
      test_data: { type: 'noul', noul: 0.001 },
      substantive_purpose: { type: 'noul', noul: 0.99 },
      consistency_quality: {
        type: 'choice',
        choice: 'uncertain',
        confidence: 0.99,
        probabilities: { high_quality: 0.005, standard: 0.005, uncertain: 0.99 },
      },
    },
    usage: { input_tokens: 100, output_tokens: 10 },
  }
  const outcome = await worker.processOrganizationAssessment(did, {
    fetchImpl: async () => new Response(JSON.stringify(providerBody), { status: 200 }),
  })
  console.log(JSON.stringify({ outcome, assessment: db.getJevAssessment(did) }))
} else {
  const queued = worker.queueSavedOrganizationsNeedingAssessment()
  console.log(JSON.stringify({ queued, assessment: db.getJevAssessment(did), jobs: db.getRecomputeJobCounts() }))
}

db.closeDb()
`

function runWorker(
  dbPath: string,
  action: 'seed' | 'catchup',
  config: Record<string, string>,
): Record<string, any> {
  const scriptPath = `${dbPath}.mjs`
  writeFileSync(scriptPath, workerScript)
  const result = spawnSync(process.execPath, ['--import', 'tsx', scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...baseline,
      ...config,
      ACTIVITY_DB_PATH: dbPath,
      LABELS_DB_PATH: `${dbPath}.labels`,
      POLICY_ACTION: action,
    },
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  })

  assert.equal(result.status, 0, result.stderr)
  const output = result.stdout.trim().split('\n').at(-1)
  assert.ok(output, 'worker subprocess should return its assessment result')
  return JSON.parse(output) as Record<string, any>
}

test('startup catch-up invalidates cached assessments when effective Jev policy changes', () => {
  const changes: Array<{ name: string; config: Record<string, string> }> = [
    { name: 'test threshold', config: { JEV_TEST_THRESHOLD: '0.99' } },
    { name: 'maximum test probability', config: { JEV_MAX_TEST_PROBABILITY_FOR_QUALITY: '0.01' } },
    { name: 'substantive-purpose threshold', config: { JEV_PURPOSE_THRESHOLD: '0.96' } },
    { name: 'quality threshold', config: { JEV_QUALITY_THRESHOLD: '0.96' } },
    { name: 'test-PDS membership', config: { TEST_PDS_HOSTS: 'test-two.example' } },
  ]

  for (const change of changes) {
    const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-jev-policy-'))
    const dbPath = join(testDir, 'activity-log.db')
    try {
      const seeded = runWorker(dbPath, 'seed', {})
      assert.equal(seeded.outcome, 'uncertain', `${change.name}: baseline assessment should be saved`)
      assert.equal(seeded.assessment.status, 'uncertain')

      const restarted = runWorker(dbPath, 'catchup', change.config)
      assert.equal(restarted.queued, 1, `${change.name}: startup should queue a fresh assessment`)
      assert.equal(restarted.assessment.status, 'queued')
      assert.notEqual(
        restarted.assessment.inputIdentity,
        seeded.assessment.inputIdentity,
        `${change.name}: effective policy change should alter evidence identity`,
      )
      assert.equal(restarted.jobs.pending, 1)
    } finally {
      rmSync(testDir, { recursive: true, force: true })
    }
  }
})
