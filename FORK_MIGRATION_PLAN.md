# Fork Migration Plan

## Goal

Turn this fork into a labeler for `app.certified.actor.organization` while upgrading the main dependencies safely.

## Guiding principle

Do this in two tracks:

1. **Infra upgrades**
   - package bumps
   - Tap handling improvements
   - generic cleanup
2. **Domain migration**
   - switch collection
   - switch lexicon/types/parser
   - adjust scoring
   - rename branding/docs/UI

Keep those separate as long as possible.

## Phase 1: Stabilize the fork structure

### Branches

Create or use branches like:

- `main` → stable fork baseline
- `upgrade-infra` → dependency upgrades only
- `organization-labeler` → collection/domain migration
- optional: `generic-refactor` → reusable abstractions if needed

### Outcome

Keep upstreamable work separate from app-specific work.

## Phase 2: Baseline audit before changing behavior

### Confirm current behavior

Document the current working behavior in the fork:

- Tap receives backfill and live events
- collection filtered to the current source collection
- records validated against the current lexicon
- score written to SQLite
- AT Protocol label applied to record URI
- dashboard shows recent items and stats

### Why

You want a known-good baseline before upgrades.

## Phase 3: Infra upgrades only

### Upgrade targets

In `upgrade-infra`:

1. `@atproto/tap` → `0.2.13`
2. `@atproto/api` → `0.19.9`
3. `next` → `16.x`
4. align:
   - `react`
   - `react-dom`
5. refresh the lockfile and test

### Validate after each step

After each package family bump, verify:

- install works
- typecheck/build works
- labeler starts
- Tap consumer still receives events
- dashboard still builds and loads

### Important

Do Tap/API upgrades before Next 16 if possible, because those affect the labeler core more directly.

## Phase 4: Identify reusable vs app-specific code

Split the code mentally into:

### Reusable infrastructure

These likely stay:

- labeler server wrapper
- Tap startup/shutdown flow
- DB logging pattern
- label sync / negation logic
- metrics/logging
- dashboard API pattern

### App-specific pieces

These must change:

- collection constant
- lexicon parser/type imports
- scorer
- UI copy
- docs
- metadata/OpenGraph
- any hardcoded links or labels

## Phase 5: Collection migration

### Replace collection target

Move from the legacy collection to:

- `app.certified.actor.organization`

### Update all collection-bound logic

That includes:

- config constant
- Tap filter
- record URI construction
- lexicon validation import
- record type imports
- any collection-specific links in UI/docs

### Outcome

The pipeline listens to and validates organization records instead of the old source collection.

## Phase 6: Adjust the scoring model

Current scoring is tuned for the old domain, so do not try to force it.

### New scoring rubric for organizations

Define what you actually want to label. Likely one of:

- organization completeness
- organization quality
- likely spam/test
- trust/readiness

### Example signals

Potential organization criteria:

- display name quality
- description quality
- avatar present
- banner present
- website present
- placeholder/test text detection
- repetition/gibberish detection

### Decide labels

Ask whether the labels should remain:

- `high-quality`
- `standard`
- `draft`
- `likely-test`

or become organization-specific.

That decision affects both label definitions and UI wording.

## Phase 7: Rename product/UI/docs

The fork should read as an organization-labeling product, not a renamed activity scorer.

### Update

- metadata descriptions
- dashboard copy
- docs page
- feed text
- loading/empty states
- label descriptions
- OpenGraph assets/text
- any hardcoded external URLs pointing at old viewers

### Outcome

The product matches the organization migration path.

## Phase 8: Make it configurable where it helps

Not everything needs to be generic, but a few things should be.

### Good candidates for config/abstraction

- target collection NSID
- parser/validator
- score function
- UI copy strings
- label definitions
- external record URL builder

### Avoid overengineering

Do not fully genericize everything on day one unless you know you need multi-collection support.

## Phase 9: End-to-end validation

Before merging back to the fork `main`, test:

### Labeler runtime

- starts cleanly
- Tap healthy
- receives backfill/live events
- skips invalid/deletes correctly
- stores rows in DB
- applies labels correctly
- re-labels correctly if classification changes

### Dashboard

- builds on Next 16
- API routes work
- stats load
- recent feed renders
- empty state and search/filter still make sense

### Data correctness

- record URI correct for `app.certified.actor.organization`
- parser matches the actual organization schema
- scorer does not rely on missing fields from the old domain

## Phase 10: Upstream strategy

After things are stable, split changes into buckets:

### Potentially upstreamable

- package upgrades
- Tap improvements
- startup/shutdown robustness
- generic label sync fixes
- config cleanup

### Probably not upstreamable

- organization-specific collection migration
- scoring rubric changes
- new branding/docs/product direction

## Key risks to watch

### 1. Major-version package breakage

Especially:

- Tap API/event shape
- AT Protocol client types
- Next 16 compatibility

### 2. Hidden old-domain assumptions

There are likely many across code, docs, labels, and UI.

### 3. Scoring mismatch

Organization records may be simpler than the previous domain, so the old scoring model cannot just be reused.

### 4. Mixed commits

Do not mix:

- infra upgrades
- collection migration
- scoring adjustment
- branding cleanup

That makes debugging much harder.

## Suggested execution order

1. Fork baseline confirmed
2. Create `upgrade-infra`
3. Upgrade Tap/API
4. Upgrade Next/React
5. Merge infra branch into fork `main`
6. Create `organization-labeler`
7. Switch collection and parser/types
8. Adjust scorer
9. Rename UI/docs/branding
10. End-to-end test
11. Decide what to upstream

## Recommendation in one line

Upgrade the reusable infrastructure first, then migrate the domain to certified actor organizations in a separate branch.

## Execution checklist / TODO

Use this as the working checklist while implementing the migration.

### Fork baseline

- [ ] Confirm fork is cloned locally and original repo is added as `upstream`
- [ ] Confirm current `main` builds and starts before changes
- [ ] Confirm current labeler still ingests the current source collection
- [ ] Capture baseline notes on current behavior and any existing breakage

### Branching

- [ ] Create `upgrade-infra` branch
- [ ] Create `organization-labeler` branch
- [ ] Keep infra commits separate from domain/product commits

### Infra upgrades

- [ ] Upgrade `@atproto/tap` to `0.2.13`
- [ ] Verify Tap startup, health checks, and event handling still work
- [ ] Upgrade `@atproto/api` to `0.19.9`
- [ ] Fix any AT Protocol client/type breakage
- [ ] Upgrade `next` to `16.x`
- [ ] Align `react` and `react-dom` with the Next 16-compatible versions
- [ ] Refresh lockfile
- [ ] Run install/build/typecheck after each package family change

### Reusable infra review

- [ ] Identify which improvements are generic enough to upstream later
- [ ] Isolate generic Tap/runtime fixes from organization-specific logic
- [ ] Isolate generic config cleanup from branding/scoring changes

### Collection migration

- [ ] Replace the current collection with `app.certified.actor.organization` where appropriate
- [ ] Update config constant(s)
- [ ] Update Tap filter configuration
- [ ] Update URI construction logic
- [ ] Switch lexicon validation to `app.certified.actor.organization`
- [ ] Switch record types/imports to the organization lexicon

### Scoring adjustment

- [ ] Decide what the new labels actually represent
- [ ] Define scoring criteria for organization records
- [ ] Remove old-domain assumptions from the scorer
- [ ] Add organization-specific quality/test/spam signals
- [ ] Decide whether to keep current tier names or rename them
- [ ] Update label definitions and descriptions accordingly

### UI / product cleanup

- [ ] Replace stale copy in the dashboard
- [ ] Update docs page text and examples
- [ ] Update metadata and OpenGraph text
- [ ] Remove or replace old-domain links/viewers
- [ ] Update empty states and feed descriptions for organization labeling

### Validation

- [ ] Confirm labeler starts cleanly after migration
- [ ] Confirm Tap receives backfill and live organization events
- [ ] Confirm invalid/deleted records are handled safely
- [ ] Confirm DB rows are written correctly for organization records
- [ ] Confirm labels are applied to the correct record URIs
- [ ] Confirm reclassification flows still work if the result changes
- [ ] Confirm dashboard pages and API routes still work

### Review before merge

- [ ] Review commit history for mixed concerns and split if needed
- [ ] Identify which commits could be upstreamed later
- [ ] Merge `upgrade-infra` into fork `main` only when stable
- [ ] Merge `organization-labeler` after end-to-end validation passes
- [ ] Document any intentional divergence from upstream

## Post-migration review

After the migration is complete, review whether the fork now does the following:

- [ ] Upgraded core dependencies successfully
- [ ] Preserved the reusable Tap → score → label pipeline
- [ ] Switched ingestion to certified actor organizations
- [ ] Uses the correct organization lexicon and record shape throughout
- [ ] Applies a scoring model that makes sense for organization data
- [ ] No longer relies on stale copy, docs, or links
- [ ] Still has a clean separation between upstreamable infra changes and app-specific changes
- [ ] Is in a state where future upstream PRs are still practical
