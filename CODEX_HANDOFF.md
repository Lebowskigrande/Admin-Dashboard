# Codex Handoff

## Coordinator Resume Point
1. Primary integration branch: `integration/finalization`
2. Latest pushed integration commit: `d4700af`
3. Previous major integration milestone: `1ba2472` (Agent E merged)
4. Current phase: post-feature integration, pre-RC hardening

## Completed Scope (A-G Waves)
1. Agent A merged: Sunday + Constant Contact integration updates.
2. Agent B merged: ShareFile parsing/routing hardening.
3. Agent C merged: Calendar/task linkage, state normalization, owner editing.
4. Agent D merged: People/Buildings/Vestry workflow completion.
5. Agent E merged: Settings/Ops readiness, runtime config validation, ops endpoints, admin audit logging/runbook.
6. Agent F merged: support scripts and coordinator guardrails.
7. Agent G integrated all waves and pushed with strict checks passing.

## Quality Gate Status (latest integration)
1. `npm run test:quick` -> PASS (10 passed, 0 failed)
2. `npm run check:contracts:strict` -> PASS
3. `npm run smoke:routes:strict` -> PASS

## Branch/Worktree Layout
1. Coordinator base path: `C:\Users\Secretary\Documents\Admin Dashboard` on `new-db-schema`.
2. Agent worktrees:
- `C:\Users\Secretary\Documents\AdminDashboard-A` -> `agent-a-sunday-comms`
- `C:\Users\Secretary\Documents\AdminDashboard-B` -> `agent-b-finance-sharefile`
- `C:\Users\Secretary\Documents\AdminDashboard-C` -> `agent-c-calendar-tasks`
- `C:\Users\Secretary\Documents\AdminDashboard-D` -> `agent-d-buildings-people-vestry`
- `C:\Users\Secretary\Documents\AdminDashboard-E` -> `agent-e-settings-ops`
- `C:\Users\Secretary\Documents\AdminDashboard-F` -> `agent-f-platform-quality`
- `C:\Users\Secretary\Documents\AdminDashboard-G` -> `integration/finalization`

## Key Artifacts To Read First
1. `AGENT_KICKOFF_INDEX.md`
2. `MULTI_AGENT_WORK_PLAN.md`
3. `PROJECT_FINALIZATION_PLAN.md`
4. `agent-reports/REPORT_TEMPLATE.md`

## Operational Notes
1. Local Git sometimes fails commit with `env.exe ... couldn't create signal pipe, Win32 error 5`; elevated commit retry works.
2. Worktrees are configured as safe directories for this environment.
3. `AGENT_INSTRUCTIONS.md` is locally ignored in each worktree (`info/exclude`) to avoid false dirty-state pauses.

## Restart Prompt (for next Codex instance)
Use this exact kickoff:

`Read CODEX_HANDOFF.md and resume coordinator mode from integration/finalization commit d4700af. Use existing A-G worktrees, keep G as integrator, and continue toward release/rc1 hardening.`
