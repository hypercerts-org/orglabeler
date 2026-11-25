---
"certified-organization-labeler": patch
---

- Purge a deleted account. When Tap reports an account `deleted`, the labeler removes its profile and organization snapshots, scores, PDS cache entry, and queued jobs, and negates its quality labels. In-flight PDS lookups and startup label sync cannot undo the purge. Deactivated, taken-down, and suspended accounts keep their state and labels.
