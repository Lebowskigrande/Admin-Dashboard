# Multi-Agent Work Plan

## Objective
Run multiple AI agents in parallel to finalize the dashboard faster without merge conflicts or contract drift.

## Orchestration Model
1. One coordinator agent manages backlog, contracts, merge order, and integration gates.
2. Feature agents own bounded vertical slices (frontend + backend + migration + tests for their slice).
3. A platform agent handles shared infrastructure (routing, lint, CI, env validation).
4. An integration agent continuously rebases, runs full checks, and resolves cross-slice conflicts.

## Parallel Agent Tracks
1. Agent A: Sunday/Bulletins/Communications
- Fix endpoint mismatches.
- Unify bulletin lifecycle and weekly email flow.
- Ship complete UI + API + persistence + tests.

2. Agent B: Finance/ShareFile Routing
- Finish parsing reliability and multi-account routing behavior.
- Build operator diagnostics (last run, failures, retry).
- Add regression tests for known email formats.

3. Agent C: Calendar/Events/Task Engine
- Validate event occurrence, template fields, doc upload, and task seeding.
- Fix edge cases in origin linking and recurrence behavior.
- Add integration tests for critical calendar/task flows.

4. Agent D: Buildings/People/Vestry
- Complete CRUD and linked workflows.
- Validate document open/print/download and packet generation.
- Remove remaining local-only states for core actions.

5. Agent E: Settings/Operations Panel
- Replace settings placeholders with real controls.
- Add integration status cards and scheduler controls.
- Add backup/restore visibility and diagnostics.

6. Agent F (Platform): API Surface + Quality
- Normalize route mounts and API prefixes.
- Fix lint baseline and introduce test command standardization.
- Add startup env/dependency validation checks.

7. Agent G (Integration): Merge + Verification
- Daily integration branch updates.
- Run full lint/tests/smoke checks.
- Own conflict resolution and release readiness report.

## Shared Contracts (Must Be Frozen First)
1. API contract document:
- Request/response schemas for each endpoint.
- Canonical path map (`/api/...` only).

2. Data contract document:
- Table ownership per feature.
- Migration naming and ordering rules.

3. UI contract document:
- Route map and navigation ownership.
- Component boundaries for shared widgets.

## Branch Strategy
1. `main` stays protected.
2. `integration/finalization` receives daily merges from agent branches.
3. Agent branches:
- `agent-a-sunday-comms`
- `agent-b-finance-sharefile`
- `agent-c-calendar-tasks`
- `agent-d-buildings-people-vestry`
- `agent-e-settings-ops`
- `agent-f-platform-quality`

## Work Sequencing
1. Day 0-1: Coordinator + Platform freeze contracts and fix duplicate route mounts.
2. Day 1+: Agents A-E build in parallel using frozen contracts.
3. Daily: Integration agent merges all active branches into `integration/finalization`.
4. End of each slice: feature agent submits with tests + migration notes + rollout notes.

## Definition Of Done Per Agent PR
1. Feature behavior works end-to-end in UI and API.
2. Contract docs updated if any schema/path changes.
3. Tests added/updated for happy path and one failure path.
4. No new lint violations introduced.
5. Includes operator-facing error messages and logs.

## Merge Gates
1. Required checks on each PR:
- Lint
- Feature tests
- Migration safety check

2. Required checks on integration branch:
- Full lint
- Full test suite
- App smoke run for key pages

## Coordination Cadence
1. Daily standup output (single markdown note):
- What changed
- API/schema changes
- Risks/blockers
- Required cross-agent actions

2. Daily integration report:
- Pass/fail summary
- Conflict list
- Regressions discovered

## Risk Controls
1. No silent API changes; contract update required first.
2. No shared file edits without coordinator approval when avoidable.
3. Migrations must be additive unless explicitly approved.
4. Pollers/automations default to safe-off until operator-enabled.

## Suggested Timeline
1. Week 1:
- Contract freeze
- Platform normalization
- Parallel feature implementation starts

2. Week 2:
- Feature completion
- Test expansion
- Integration hardening

3. Week 3:
- UAT cycle
- Defect burn-down
- Release candidate
