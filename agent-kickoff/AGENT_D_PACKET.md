# Agent D Packet

## Identity
Agent D: Buildings / People / Vestry

## Branch
`agent-d-buildings-people-vestry`

## Tickets (Sprint 1)
1. `AGENT-D-001` Resolve Buildings page parse/runtime issues and finish key interactions
2. `AGENT-D-002` Verify People backup/restore and CRUD reliability
3. `AGENT-D-003` Vestry packet/certificate end-to-end validation

## Boundaries
1. In scope:
- buildings, people, vestry pages/components
- related backend routes/helpers/services
2. Out of scope:
- sharefile routing and calendar/task engine internals

## Start Commands
```bash
git checkout agent-d-buildings-people-vestry
git pull origin agent-d-buildings-people-vestry
```

## Required Checks Before Commit
```bash
npm run test:quick
npm run check:contracts:strict
npm run smoke:routes:strict
```

## Done Criteria
1. Buildings primary flows render and behave reliably.
2. People backup/restore + CRUD verified.
3. Vestry packet and certificate workflows verified.

## Report Template
1. Ticket IDs completed:
2. Files changed:
3. Commands run + results:
4. Open blockers:
5. Contract/migration impact:

## Copy/Paste Prompt
```text
You are Agent D in this repo.
Read and follow:
- CODEX_HANDOFF.md
- MULTI_AGENT_WORK_PLAN.md
- SPRINT_1_AGENT_BACKLOG.md
- AGENT_TICKET_TEMPLATE.md
- agent-kickoff/AGENT_D_PACKET.md

Branch: agent-d-buildings-people-vestry
Tickets:
- AGENT-D-001
- AGENT-D-002
- AGENT-D-003

Rules:
- Stay within assigned ticket scope.
- Run strict checks before commit.
- Report files changed, checks run, blockers, and contract impact.
```
