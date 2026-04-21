// src/labeler/reset-db.ts
// Run with: npx tsx src/labeler/reset-db.ts

import * as fs from "node:fs"
import { ACTIVITY_DB_PATH } from "../lib/config"

function main() {
  const files = [ACTIVITY_DB_PATH, "labels.db"]
  for (const file of files) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
      console.log(`  ✓ Deleted ${file}`)
    } else {
      console.log(`  - ${file} not found (skipping)`)
    }
  }
  // Also delete WAL and SHM files
  for (const file of files) {
    for (const suffix of ["-wal", "-shm"]) {
      const walFile = file + suffix
      if (fs.existsSync(walFile)) {
        fs.unlinkSync(walFile)
        console.log(`  ✓ Deleted ${walFile}`)
      }
    }
  }
  // Reset cursor
  if (fs.existsSync("cursor.txt")) {
    fs.unlinkSync("cursor.txt")
    console.log("  ✓ Deleted cursor.txt")
  }
  console.log("\nDatabases reset. Run npm run labeler to start fresh.")
}

main()
