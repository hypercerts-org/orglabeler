import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>
}
const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8')
const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8')

test('workflow commands use installed package scripts instead of npx', () => {
  assert.equal(packageJson.scripts['changeset:status'], 'changeset status')
  assert.equal(packageJson.scripts['type-check'], 'tsc --noEmit')
  assert.doesNotMatch(ciWorkflow, /\bnpx\b/)
  assert.doesNotMatch(releaseWorkflow, /\bnpx\b/)
})

test('release dependency installs disable implicit lifecycle scripts', () => {
  const installCommands = releaseWorkflow.match(/^\s+run: npm ci.*$/gm)

  assert.deepEqual(installCommands, [
    '        run: npm ci --ignore-scripts',
    '        run: npm ci --ignore-scripts',
    '        run: npm ci --ignore-scripts',
  ])
})

test('release validation explicitly rebuilds required native dependencies', () => {
  assert.match(
    releaseWorkflow,
    /run: npm ci --ignore-scripts\n\n      - name: Build required native dependencies\n        run: npm rebuild better-sqlite3 esbuild sharp/,
  )
})
