# Codex Handoff

## Current Branch + State
1. Primary working branch: `new-db-schema` in `C:\Users\Secretary\Documents\Admin Dashboard`.
2. Worktree cleanup complete:
- Removed: `AdminDashboard-A` through `AdminDashboard-F`
- Kept: `AdminDashboard-G` (`integration/finalization`) as integrator/staging lane.

## What Was Completed
1. ShareFile contribution parsing/routing hardening:
- clean contribution filename framework (source/date/name/amount rules)
- clean note framework (envelope + designation)
- fixed forwarded-thread message selection to use original message metadata/body
- corrected date off-by-one handling from email headers
- envelope lookup fallbacks (People tags + canonical XLSX)
- poller label flow for `Unprocessed donations` and `ShareFile Routed`
- keep routed emails in inbox (no archive)

2. AP routing hardening:
- prioritize PDF attachments in thread
- fallback to full thread text when no PDF is present
- improved email rendering path for better fidelity

3. Finance UI updates:
- AR/AP routing panels set to fixed container heights with scrolling content

4. Constant Contact wiring:
- backend disconnect endpoint: `POST /api/constant-contact/disconnect`
- Settings UI card for CC connect/status/disconnect and verified sender visibility
- Sunday Livestream panel wired to create/schedule CC email via API

5. Liturgical schedule export date fix:
- fixed timezone/day-shift bug in PDF/XLSX exports by parsing `YYYY-MM-DD` as local calendar date.

## Tests Run (latest)
1. `npm run test:quick` -> PASS (17 passed, 0 failed)
2. `npm run smoke:routes:strict` -> PASS
3. `npm run build` -> blocked in this environment (`spawn EPERM` from esbuild process spawn)

## Active Worktree Layout
1. `C:\Users\Secretary\Documents\Admin Dashboard` -> `new-db-schema` (primary)
2. `C:\Users\Secretary\Documents\AdminDashboard-G` -> `integration/finalization` (kept intentionally)

## Restart Prompt
Use this exact kickoff tomorrow:

`Read CODEX_HANDOFF.md, continue from new-db-schema, keep only the main worktree plus AdminDashboard-G integrator, and proceed with feature improvements + RC1 hardening validation.`
