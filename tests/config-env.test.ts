import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

function readConfigWithEnv(env: Partial<NodeJS.ProcessEnv>): Record<string, string> {
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    '--input-type=module',
    '-e',
    `import { LABELER_IDENTIFIER, LABELER_PASSWORD } from './src/lib/config.ts'
console.log(JSON.stringify({ LABELER_IDENTIFIER, LABELER_PASSWORD }))`,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout) as Record<string, string>
}

test('labeler account credentials use LABELER_* environment variables', () => {
  const config = readConfigWithEnv({
    LABELER_IDENTIFIER: 'orglabeler.certified.one',
    LABELER_PASSWORD: 'app-password',
  })

  assert.equal(config.LABELER_IDENTIFIER, 'orglabeler.certified.one')
  assert.equal(config.LABELER_PASSWORD, 'app-password')
})

test('Jev API key, model, timeout, and confidence thresholds are configurable', () => {
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    '--input-type=module',
    '-e',
    `import { TYPESAFE_API_KEY, JEV_MODEL, JEV_REQUEST_TIMEOUT_MS, JEV_TEST_THRESHOLD, JEV_MAX_TEST_PROBABILITY_FOR_QUALITY, JEV_PURPOSE_THRESHOLD, JEV_QUALITY_THRESHOLD } from './src/lib/config.ts'
console.log(JSON.stringify({ hasApiKey: Boolean(TYPESAFE_API_KEY), model: JEV_MODEL, timeoutMs: JEV_REQUEST_TIMEOUT_MS, testThreshold: JEV_TEST_THRESHOLD, maxTestProbabilityForQuality: JEV_MAX_TEST_PROBABILITY_FOR_QUALITY, purposeThreshold: JEV_PURPOSE_THRESHOLD, qualityThreshold: JEV_QUALITY_THRESHOLD }))`,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TYPESAFE_API_KEY: 'test-key',
      JEV_MODEL: 'jev-stable-test',
      JEV_REQUEST_TIMEOUT_MS: '12500',
      JEV_TEST_THRESHOLD: '0.97',
      JEV_MAX_TEST_PROBABILITY_FOR_QUALITY: '0.01',
      JEV_PURPOSE_THRESHOLD: '0.94',
      JEV_QUALITY_THRESHOLD: '0.96',
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    hasApiKey: true,
    model: 'jev-stable-test',
    timeoutMs: 12500,
    testThreshold: 0.97,
    maxTestProbabilityForQuality: 0.01,
    purposeThreshold: 0.94,
    qualityThreshold: 0.96,
  })
})

test('admin auth configuration fails closed on a missing allowlist or invalid origin', () => {
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    '--input-type=module',
    '-e',
    `import { ADMIN_DIDS_CONFIG, ADMIN_ORIGIN } from './src/lib/config.ts'
console.log(JSON.stringify({ adminDids: ADMIN_DIDS_CONFIG.dids, adminDidsError: ADMIN_DIDS_CONFIG.error, adminOrigin: ADMIN_ORIGIN }))`,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ADMIN_DIDS: 'did:example:admin,not-a-did',
      ADMIN_ORIGIN: 'https://example.com/admin',
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    adminDids: [],
    adminDidsError: 'ADMIN_DIDS contains an invalid DID',
    adminOrigin: null,
  })
})

test('invalid Jev confidence thresholds fall back to conservative defaults', () => {
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    '--input-type=module',
    '-e',
    `import { JEV_TEST_THRESHOLD, JEV_MAX_TEST_PROBABILITY_FOR_QUALITY, JEV_PURPOSE_THRESHOLD, JEV_QUALITY_THRESHOLD } from './src/lib/config.ts'
console.log(JSON.stringify({ testThreshold: JEV_TEST_THRESHOLD, maxTestProbabilityForQuality: JEV_MAX_TEST_PROBABILITY_FOR_QUALITY, purposeThreshold: JEV_PURPOSE_THRESHOLD, qualityThreshold: JEV_QUALITY_THRESHOLD }))`,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      JEV_TEST_THRESHOLD: '1.1',
      JEV_MAX_TEST_PROBABILITY_FOR_QUALITY: '-0.1',
      JEV_PURPOSE_THRESHOLD: 'invalid',
      JEV_QUALITY_THRESHOLD: 'NaN',
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    testThreshold: 0.98,
    maxTestProbabilityForQuality: 0.02,
    purposeThreshold: 0.95,
    qualityThreshold: 0.95,
  })
})

test('admin OAuth configuration reports missing signing and encryption keys without exposing values', () => {
  const script = `import { getAdminOAuthConfigurationIssue } from './src/lib/admin-oauth.ts'
console.log(getAdminOAuthConfigurationIssue())`
  const baseEnv = {
    ...process.env,
    ADMIN_DIDS: 'did:example:admin',
    ADMIN_ORIGIN: 'https://example.com',
  }
  const missingSigningKey = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: { ...baseEnv, ADMIN_OAUTH_SIGNING_KEY: '', ADMIN_OAUTH_ENCRYPTION_KEY: 'a'.repeat(64) },
    encoding: 'utf8',
  })
  assert.equal(missingSigningKey.status, 0, missingSigningKey.stderr)
  assert.match(missingSigningKey.stdout, /ADMIN_OAUTH_SIGNING_KEY/)

  const missingEncryptionKey = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: {
      ...baseEnv,
      ADMIN_OAUTH_SIGNING_KEY: Buffer.from('-----BEGIN PRIVATE KEY-----\\nplaceholder\\n-----END PRIVATE KEY-----\\n').toString('base64'),
      ADMIN_OAUTH_ENCRYPTION_KEY: '',
    },
    encoding: 'utf8',
  })
  assert.equal(missingEncryptionKey.status, 0, missingEncryptionKey.stderr)
  assert.match(missingEncryptionKey.stdout, /ADMIN_OAUTH_ENCRYPTION_KEY/)
  assert.doesNotMatch(missingEncryptionKey.stdout, /placeholder/)
})
