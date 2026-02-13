# Agent E Packet

## Identity
Agent E: Settings / Operations UX

## Branch
`agent-e-settings-ops`

## Tickets (Sprint 1)
1. `AGENT-E-001` Replace Settings placeholder section with operations controls
2. `AGENT-E-002` Expose scheduler/poller status and safe controls
3. `AGENT-E-003` Add unified error/status surfacing pattern

## Boundaries
1. In scope:
- `src/pages/Settings.jsx` and related styles/components
- backend status/control endpoints needed by Settings
2. Out of scope:
- deep feature business logic outside settings/ops surfaces

## Start Commands
```bash
git checkout agent-e-settings-ops
git pull origin agent-e-settings-ops
```

## Required Checks Before Commit
```bash
npm run test:quick
npm run check:contracts:strict
npm run smoke:routes:strict
```

## Done Criteria
1. Settings has operational controls, no placeholder-only section.
2. Scheduler/poller state visible and actionable.
3. Error/status messaging consistent across integrations.

## Report Template
1. Ticket IDs completed:
2. Files changed:
3. Commands run + results:
4. Open blockers:
5. Contract/migration impact:

## Copy/Paste Prompt
```text
You are Agent E in this repo.
Read and follow:
- CODEX_HANDOFF.md
- MULTI_AGENT_WORK_PLAN.md
- SPRINT_1_AGENT_BACKLOG.md
- AGENT_TICKET_TEMPLATE.md
- agent-kickoff/AGENT_E_PACKET.md

Branch: agent-e-settings-ops
Tickets:
- AGENT-E-001
- AGENT-E-002
- AGENT-E-003

Rules:
- Stay within assigned ticket scope.
- Run strict checks before commit.
- Report files changed, checks run, blockers, and contract impact.
```
