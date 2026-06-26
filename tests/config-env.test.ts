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
