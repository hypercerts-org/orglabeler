#!/usr/bin/env tsx
// Run with: npx tsx src/labeler/setup.ts <labeler-identifier> <password> [labeler-endpoint] [--token PLC_TOKEN]
// Or: npm run setup -- orglabeler.certified.one mypassword https://orglabeler.hypercerts.dev

import { plcRequestToken, plcSetupLabeler } from '@skyware/labeler/scripts'
import 'dotenv/config'
import { secp256k1 } from '@noble/curves/secp256k1'
import * as fs from 'node:fs'
import * as readline from 'node:readline'
import { LABELS } from '../lib/constants'
import { declareLabeler } from './declare-labeler'
import { resolvePds } from '../lib/resolve-pds'

// --- Arg / env parsing ---

const identifier = process.argv[2] || process.env.LABELER_IDENTIFIER || ""
const password = process.argv[3] || process.env.LABELER_PASSWORD || ""

if (!identifier || !password) {
  console.error("Usage: npx tsx src/labeler/setup.ts <labeler-identifier> <password> [labeler-endpoint] [--token PLC_TOKEN]")
  console.error("  Or set LABELER_IDENTIFIER and LABELER_PASSWORD env vars.")
  process.exit(1)
}

const labelerEndpoint =
  process.argv[4] ||
  process.env.NEXT_PUBLIC_LABELER_ENDPOINT ||
  `https://labeler.${identifier}`

// Find --token flag or use 5th positional arg or PLC_TOKEN env var
const existingToken = (() => {
  const tokenIdx = process.argv.indexOf('--token')
  if (tokenIdx !== -1 && process.argv[tokenIdx + 1]) return process.argv[tokenIdx + 1]
  return process.argv[5] || process.env.PLC_TOKEN || ''
})()

console.log(`\nLabeler endpoint: ${labelerEndpoint}`)
console.log(`Account:          ${identifier}\n`)

// --- Helpers ---

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/**
 * Read .env file and return a map of key → value.
 * Lines that are comments or blank are preserved as-is under a special key.
 */
function readEnvFile(path: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!fs.existsSync(path)) return map
  const lines = fs.readFileSync(path, "utf8").split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      // Store raw comment/blank lines with a unique key so we can re-emit them
      map.set(`__raw__${map.size}`, line)
      continue
    }
    const eqIdx = line.indexOf("=")
    if (eqIdx === -1) {
      map.set(`__raw__${map.size}`, line)
      continue
    }
    const key = line.slice(0, eqIdx).trim()
    const value = line.slice(eqIdx + 1).trim()
    map.set(key, value)
  }
  return map
}

function writeEnvFile(path: string, updates: Record<string, string>): void {
  const existing = readEnvFile(path)

  // Apply updates (overwrite or add)
  for (const [k, v] of Object.entries(updates)) {
    existing.set(k, v)
  }

  // Reconstruct file: raw lines first (preserving order), then any new keys
  const lines: string[] = []
  const writtenKeys = new Set<string>()

  for (const [k, v] of existing.entries()) {
    if (k.startsWith("__raw__")) {
      lines.push(v)
    } else {
      lines.push(`${k}=${v}`)
      writtenKeys.add(k)
    }
  }

  // Add any keys from updates that weren't already in the file
  for (const [k, v] of Object.entries(updates)) {
    if (!writtenKeys.has(k)) {
      lines.push(`${k}=${v}`)
    }
  }

  fs.writeFileSync(path, lines.join("\n") + "\n", "utf8")
}

// --- Main ---

async function main() {
  // Step 1: Generate signing key
  console.log("Generating label signing key...")
  const privateKeyBytes = secp256k1.utils.randomPrivateKey()
  const signingKeyHex = Buffer.from(privateKeyBytes).toString("hex")
  console.log(`  Key generated (${signingKeyHex.slice(0, 8)}...)\n`)

  // Step 1.5: Resolve PDS from the labeler account identifier
  console.log("Resolving account PDS...")
  let did = ""
  let pdsUrl = ""
  try {
    const resolved = await resolvePds(identifier)
    did = resolved.did
    pdsUrl = resolved.pds
    console.log(`  DID: ${did}`)
    console.log(`  PDS: ${pdsUrl}\n`)
  } catch (err) {
    console.error("  ✗ Failed to resolve labeler account identifier. Check that the account exists.")
    console.error("  Error:", err)
    process.exit(1)
  }

  let plcToken = existingToken

  if (!plcToken) {
    // Step 2: Request PLC token (sends email)
    console.log("Requesting PLC operation token (this sends a confirmation email)...")
    try {
      await plcRequestToken({ identifier, password, pds: pdsUrl })
      console.log("  ✓ Token requested.\n")
    } catch (err) {
      console.error("  ✗ Failed to request PLC token. Check your labeler account identifier and password.")
      console.error("  Error:", err)
      process.exit(1)
    }

    console.log("Check your email for a confirmation code.")

    // Step 3: Prompt for PLC token (the ONE interactive step)
    plcToken = await prompt("\nPaste the PLC token from your email: ")
    if (!plcToken) {
      console.error("No token provided. Aborting.")
      process.exit(1)
    }
  } else {
    console.log(`Using provided PLC token: ${plcToken.slice(0, 5)}...\n`)
  }

  // Step 4: Setup labeler on PLC (adds signing key + labeler service to DID doc)
  console.log("\nSetting up labeler on PLC directory...")
  try {
    await plcSetupLabeler({
      identifier,
      password,
      pds: pdsUrl,
      plcToken,
      endpoint: labelerEndpoint,
      privateKey: signingKeyHex,
      overwriteExistingKey: true,
    })
    console.log("  ✓ Labeler registered on PLC.\n")
  } catch (err) {
    console.error("  ✗ Failed to set up labeler on PLC.")
    console.error("  The PLC token may have expired (they expire quickly — request a new one).")
    console.error("  Error:", err)
    process.exit(1)
  }

  // Step 5: Declare labeler with label definitions
  console.log("Declaring label definitions...")
  const labelDefs = LABELS.map(label => ({
    identifier: label.identifier,
    severity: "inform" as const,
    blurs: "none" as const,
    defaultSetting: "warn" as const,
    adultOnly: false,
    locales: label.locales,
  }))

  try {
    await declareLabeler({ identifier, password, pds: pdsUrl }, labelDefs, true)
    for (const label of LABELS) {
      console.log(`  ✓ ${label.identifier}: ${label.locales[0]?.name}`)
    }
    console.log()
  } catch (err) {
    console.error("  ✗ Failed to declare labels.")
    console.error("  Note: PLC setup succeeded. You can retry labels later with: npm run set-labels")
    console.error("  Error:", err)
    // Don't exit — continue to write .env with what we have
  }

  // Step 6: Write .env (preserve existing values, update/add our keys)
  const envPath = ".env"
  const updates: Record<string, string> = {
    LABELER_IDENTIFIER: identifier,
    LABELER_PASSWORD: password,
    SIGNING_KEY: signingKeyHex,
    NEXT_PUBLIC_LABELER_ENDPOINT: labelerEndpoint,
    PDS_URL: pdsUrl,
  }
  if (did) updates.DID = did

  writeEnvFile(envPath, updates)
  console.log(`✓ Written to ${envPath}`)

  // Step 7: Print success summary
  console.log("\n=== Setup Complete ===")
  if (did) console.log(`DID:             ${did}`)
  console.log(`Signing key:     ${signingKeyHex.slice(0, 8)}...`)
  console.log(`Labeler endpoint: ${labelerEndpoint}`)
  console.log("\nNext steps:")
  console.log("  npm run labeler      — start the labeler backend")
  console.log("  npm run dev           — start the dashboard")
}

main().catch(err => {
  console.error("Unexpected error:", err)
  process.exit(1)
})
