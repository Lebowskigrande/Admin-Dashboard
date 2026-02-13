# Admin Dashboard Finalization Plan

## Goal
Ship the full dashboard as a reliable operations system for weekly church administration workflows, not just feature demos.

## Current Findings
1. API/Frontend contract mismatches exist.
- `src/pages/Sunday.jsx` calls `POST /bulletins/upload`, but no matching server route is present.
2. Duplicate route mounts create risk.
- `server/index.js` mounts `sharefileRouter` twice.
- `server/index.js` mounts `sundayRouter` twice.
3. Some pages are still stub/demo-level.
- `src/pages/Communications.jsx` uses local in-memory state only.
- `src/pages/Bulletins.jsx` uses local mock workflow only.
- `src/pages/Music.jsx` is static and not integrated.
4. Navigation and route exposure are inconsistent.
- Routes exist for `bulletins` and `communications` but are not in sidebar navigation.
5. Quality baseline is below release readiness.
- Lint reports a large backlog.
- No automated tests currently in repo.

## Phase 1: Scope Freeze And Surface Map (2-3 days)
### Objective
Lock what is in-scope for v1 release and remove ambiguous feature ownership.

### Deliverables
1. Product surface matrix (Page -> Route -> API -> DB tables -> Owner flow).
2. Keep/merge/retire decisions for:
- `Bulletins`
- `Communications`
- `Music`
- `Settings` placeholder section
3. Canonical API prefix and mount policy (`/api/...` only).

### Exit Criteria
1. Every page in router has a clear status: production, merge target, or retired.
2. Sidebar navigation reflects final in-scope pages only.

## Phase 2: Contract And Routing Corrections (3-5 days)
### Objective
Eliminate runtime breakpoints from missing endpoints and duplicate mounts.

### Deliverables
1. Fix Sunday bulletin upload contract:
- Either implement `POST /api/bulletins/upload`
- Or update frontend to existing canonical endpoint
2. Remove duplicate router mounts in `server/index.js`.
3. Add route sanity test script that verifies all frontend `fetch` endpoints resolve to a server route.
4. Normalize all client calls to canonical API paths.

### Exit Criteria
1. No known 404s for in-scope workflows.
2. No duplicate mount patterns left in server bootstrap.

## Phase 3: Complete Existing Features (2-3 weeks)
### Objective
Make all intended modules operational with persistent data and complete workflows.

### Workstream A: Sunday + Bulletins + Communications
1. Decide single source of truth for bulletin lifecycle and weekly email.
2. Connect all actions to backend persistence and status tracking.
3. Integrate Constant Contact flow in UI (status, list selection, send/schedule feedback).

### Workstream B: Finance + ShareFile
1. Finalize manual routing reliability and account selection behavior.
2. Add operator tooling:
- Last run timestamp
- Processed count
- Failure log
- Retry failed item
3. Confirm deposit packet and routing logs are coherent and recoverable.

### Workstream C: Calendar + Events + Tasks
1. Validate event occurrence editing, document upload, template fields, and task linking.
2. Ensure seeded task templates behave as expected for each event origin.
3. Resolve any orphaned task origin edge cases.

### Workstream D: Buildings + People + Vestry
1. Ensure CRUD and linked data persist correctly.
2. Validate files/open/print/download flows for docs and packets.
3. Remove or complete any placeholder-only UI states.

### Exit Criteria
1. Each in-scope module has an end-to-end tested primary workflow.
2. No module relies on ephemeral local state for core operations.

## Phase 4: Quality Hardening (1-2 weeks, parallel)
### Objective
Raise confidence for release and reduce regressions.

### Deliverables
1. Lint remediation plan:
- Fix parser/runtime-risk issues first
- Then cleanup unused/legacy imports and code
2. Test suite bootstrap:
- Parser unit tests (ShareFile, HGK parsing)
- Route integration tests for critical endpoints
- Frontend smoke tests for core pages
3. Startup checks:
- Required env vars
- Required external tool availability
- Database migration status check

### Exit Criteria
1. Lint clean (or explicit, minimal suppressions documented).
2. Critical-path tests passing in local CI command.

## Phase 5: Operations And Observability (3-5 days)
### Objective
Make support and troubleshooting practical for daily operations.

### Deliverables
1. Settings operational panel:
- Integration status (Google, ShareFile, Dropbox, Constant Contact, YouTube)
- Scheduler/poller controls
- Last/next run status
2. Unified activity log:
- Routing events
- Uploads
- Print actions
- Sync actions
- Error details
3. Backup/restore runbook and validation checklist.

### Exit Criteria
1. Operator can diagnose and recover common failures without code changes.

## Phase 6: UAT And Release Candidate (1-2 weeks)
### Objective
Validate real weekly use before final release.

### Deliverables
1. UAT checklist for weekly cycle:
- Sunday planning
- Bulletin status and print
- Finance routing
- Calendar sync and event tasking
- Vestry packet workflow
2. Defect burn-down list with severity triage.
3. Release candidate tag and rollback plan.

### Exit Criteria
1. Two consecutive UAT cycles complete with no critical blockers.

## Suggested New Features (Post-Stabilization)
1. Unified Activity Timeline with filter + replay for failed operations.
2. Global Search across people/events/tickets/documents.
3. Automation Control Center for scheduled jobs and manual run controls.

## Suggested Execution Order
1. Phase 1 and 2 immediately.
2. Phase 3 and 4 in parallel by workstream.
3. Phase 5 once core workflows are stable.
4. Phase 6 before tagging production release.

## Definition Of Done (Project)
1. All in-scope pages are discoverable in navigation and backed by persistent APIs.
2. No known contract mismatches between frontend and backend.
3. Core workflows pass smoke and integration tests.
4. Operational controls and logs are available in Settings/admin surfaces.
5. UAT cycles pass with documented runbook and rollback plan.
