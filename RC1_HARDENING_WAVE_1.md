# RC1 Hardening Wave 1 (2026-02-13)

## Baseline
1. Integration anchor: `integration/finalization` at `d4700af`.
2. Strict functional gates:
- `npm run test:quick`: PASS (10 passed, 0 failed)
- `npm run check:contracts:strict`: PASS (71 frontend paths, 99 server patterns, no missing)
- `npm run smoke:routes:strict`: PASS (12 routes, 12 sidebar links)
3. Strict lint gates:
- `npm run lint:strict`: FAIL (68 warnings, 0 errors)
- `npm run lint:server:strict`: FAIL (43 warnings, 0 errors)
- `npm run lint:client:strict`: FAIL (21 warnings, 0 errors)
- `npm run lint:extension:strict`: implicit FAIL subset (4 warnings in `parish-codes-extension/background.js`)

## Wave Goal
1. Reduce strict lint from 68 warnings to 0 without functional regressions.
2. Keep strict functional gates green after each branch merge into `integration/finalization`.
3. Produce release/rc1 readiness evidence with repeatable command outputs.

## Branch Ownership
1. Agent A (`agent-a-sunday-comms`)
- Files:
  - `src/pages/Sunday.jsx`
  - `server/helpers/sunday-utils.js`
- Scope:
  - Remove unused Sunday UI state vars.
  - Resolve `react-hooks/exhaustive-deps` warning in Sunday callback dependencies.
  - Remove unnecessary regex escapes in Sunday parsing utilities.

2. Agent B (`agent-b-finance-sharefile`)
- Files:
  - `server/services/sharefileEmailRouter.js`
  - `server/services/constantContactService.js`
- Scope:
  - Replace control-character regex pattern with lint-safe implementation.
  - Remove unused parser helpers/locals and unnecessary escapes.
  - Keep existing parser behavior and fixtures green.

3. Agent C (`agent-c-calendar-tasks`)
- Files:
  - `src/context/EventsContext.jsx`
  - `src/pages/todo/useTodoData.js`
  - `server/services/taskEngine.js`
  - `server/routes/tasks.js`
- Scope:
  - Resolve hook dependency warning in todo data layer.
  - Address React refresh export warning in events context split.
  - Remove dead task engine helpers/imports safely.

4. Agent D (`agent-d-buildings-people-vestry`)
- Files:
  - `src/pages/LiturgicalSchedule.jsx`
  - `src/pages/vestry/VestryMembersPanel.jsx`
  - `server/helpers/vestry-utils.js`
  - `server/routes/people.js`
- Scope:
  - Remove unused schedule variables and fix hook dependency warning.
  - Remove unnecessary regex escapes in Vestry members panel.
  - Remove unused vestry and people helper imports.

5. Agent E (`agent-e-settings-ops`)
- Files:
  - `src/pages/Dashboard.jsx`
  - `src/pages/Music.jsx`
  - `server/routes/files.js`
  - `server/helpers/file-utils.js`
- Scope:
  - Clear low-risk unused vars/imports in shared UI and ops-adjacent server files.
  - Validate no behavior change in dashboard and music screens.

6. Agent F (`agent-f-platform-quality`)
- Files:
  - `server/depositSlip.js`
  - `server/helpers/hgk-utils.js`
  - `server/seed.js`
  - `parish-codes-extension/background.js`
- Scope:
  - Fix remaining platform/global lint hotspots.
  - Resolve duplicate key warning in `depositSlip.js`.
  - Remove unused extension helpers or wire usage if intentional.

7. Agent G (`integration/finalization`)
- Scope:
  - Merge branches in planned order.
  - Re-run strict gates after each merge and at wave end.
  - Publish integration report per merge cycle.

## Merge Order (Wave 1)
1. Merge F (platform/global risk first).
2. Merge A and B.
3. Merge C and D.
4. Merge E.
5. Final strict gate run on G.

## Required Validation For Every Agent Commit
1. `npm run test:quick`
2. `npm run check:contracts:strict`
3. `npm run smoke:routes:strict`
4. `npm run lint:server` or `npm run lint:client` for touched scope

## Release/RC1 Exit For Wave 1
1. `npm run lint:strict` passes on integration branch.
2. Existing strict functional gates remain green.
3. Agent G report includes warning count delta and any residual risk.
