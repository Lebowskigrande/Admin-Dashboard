# Sprint 1 Agent Backlog

## Sprint Goal
Close critical contract gaps, stabilize core workflows, and establish a clean integration baseline for parallel delivery.

## Global Rules
1. Use `AGENT_TICKET_TEMPLATE.md` for each ticket.
2. No API path changes without contract note in PR.
3. Any migration must be additive and documented.
4. Every ticket must include at least one test update.

## Branches
- Agent A: `agent-a-sunday-comms`
- Agent B: `agent-b-finance-sharefile`
- Agent C: `agent-c-calendar-tasks`
- Agent D: `agent-d-buildings-people-vestry`
- Agent E: `agent-e-settings-ops`
- Agent F: `agent-f-platform-quality`
- Agent G: `integration/finalization` (integration agent)

## Agent A: Sunday + Constant Contact Automation
1. `AGENT-A-001` Fix bulletin upload contract mismatch
- Deliverable: frontend and backend use one canonical upload endpoint.
- Acceptance: Sunday bulletin upload succeeds end-to-end with persisted result.

2. `AGENT-A-002` Remove standalone Communications/Bulletins page flow from product surface
- Deliverable: no separate app routes/pages for Communications or Bulletins; workflow lives in Sunday planning only.
- Acceptance: route/nav checks pass and no dead imports remain.

3. `AGENT-A-003` Integrate Constant Contact module into Sunday workflow
- Deliverable: procedurally generate full email payload (template-driven) and schedule send from Sunday planning flow.
- Acceptance: manual test can create and schedule one complete email successfully.

## Agent B: Finance / ShareFile
1. `AGENT-B-001` Finalize multi-account candidate routing behavior
- Deliverable: reliable fallback across linked accounts without hard pinning.
- Acceptance: route same action from at least two linked inboxes.

2. `AGENT-B-002` Add routing diagnostics panel data contract
- Deliverable: API fields for last run, processed, failed, retriable entries.
- Acceptance: data visible for both success and failure scenarios.

3. `AGENT-B-003` Add parser regression tests for known AR formats
- Deliverable: fixture tests for website donation format + Bank of America format.
- Acceptance: donor/designation extraction passes all fixtures.

## Agent C: Calendar / Events / Tasks
1. `AGENT-C-001` Validate and repair event occurrence/document/task linking
- Deliverable: resolve any broken origin links and save flows.
- Acceptance: edit occurrence + upload doc + linked tasks all persist.

2. `AGENT-C-002` Harden recurring template application behavior
- Deliverable: no duplicate or orphan tasks in tested recurrence windows.
- Acceptance: sync cycle shows stable counts across repeated runs.

3. `AGENT-C-003` Add integration tests for key calendar/task routes
- Deliverable: route-level tests for `events`, `event-occurrences`, `tasks`.
- Acceptance: tests cover success + common failure cases.

## Agent D: Buildings / People / Vestry
1. `AGENT-D-001` Resolve Buildings page parse/runtime issues and finish key interactions
- Deliverable: page renders cleanly; map, tickets, and room details function.
- Acceptance: lint/parser issues removed in touched files; manual flow passes.

2. `AGENT-D-002` Verify People backup/restore and CRUD reliability
- Deliverable: predictable behavior and clear failure messaging.
- Acceptance: restore from latest backup and CRUD roundtrip tested.

3. `AGENT-D-003` Vestry packet/certificate end-to-end validation
- Deliverable: upload/cache/build packet plus certificate preview/save/print flows.
- Acceptance: all actions complete without manual DB fixes.

## Agent E: Settings / Ops
1. `AGENT-E-001` Replace Settings placeholder section with operations controls
- Deliverable: integration health cards + key toggles + run controls.
- Acceptance: no placeholder text remains for in-scope ops controls.

2. `AGENT-E-002` Expose scheduler/poller status and safe controls
- Deliverable: show enabled state, interval, last run, next run, last error.
- Acceptance: operator can disable/enable and confirm state persists.

3. `AGENT-E-003` Add unified error/status surfacing pattern
- Deliverable: consistent status badges and actionable error text across Settings.
- Acceptance: errors from each integration can be diagnosed from UI.

## Agent F: Platform / Quality
1. `AGENT-F-001` Remove duplicate router mounts and normalize API mount policy
- Deliverable: single canonical mounts in server bootstrap.
- Acceptance: no duplicate route registration for Sunday/ShareFile modules.

2. `AGENT-F-002` Establish lint baseline policy and fix P0 lint issues
- Deliverable: config updates for node/chrome contexts and parser blockers fixed.
- Acceptance: lint runs consistently; no parser errors remain.

3. `AGENT-F-003` Add startup environment validation
- Deliverable: fail-fast checks for required env vars by feature set.
- Acceptance: missing required env surfaces clear startup error.

## Agent G: Integration
1. `AGENT-G-001` Daily merge and conflict resolution into `integration/finalization`
- Deliverable: integrated branch updated daily with conflict notes.
- Acceptance: branch builds and key smoke checks pass daily.

2. `AGENT-G-002` Integration quality report
- Deliverable: daily report with pass/fail, regressions, blockers.
- Acceptance: posted each day before next merge cycle.

3. `AGENT-G-003` Sprint-end release readiness report
- Deliverable: checklist status for all Sprint 1 tickets and open risks.
- Acceptance: clear go/no-go recommendation.

## Suggested Parallel Start Order (Day 1)
1. Start first: `AGENT-F-001`, `AGENT-A-001`, `AGENT-B-001`, `AGENT-D-001`
2. Start second: `AGENT-C-001`, `AGENT-E-001`
3. Start continuous: `AGENT-G-001`

## Sprint Exit Criteria
1. Core contract gaps closed (especially bulletin upload and duplicate mounts).
2. At least one end-to-end workflow stabilized per domain track.
3. Regression tests added for ShareFile parsing and one calendar/task integration path.
4. Integration branch passes lint/test/smoke gates for in-scope tickets.
