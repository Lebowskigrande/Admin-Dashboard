# Agent C Packet

## Identity
Agent C: Calendar / Events / Task Engine

## Branch
`agent-c-calendar-tasks`

## Tickets (Sprint 1)
1. `AGENT-C-001` Validate and repair event occurrence/document/task linking
2. `AGENT-C-002` Harden recurring template application behavior
3. `AGENT-C-003` Add integration tests for key calendar/task routes

## Boundaries
1. In scope:
- `server/routes/events.js`
- `server/routes/tasks.js`
- `server/eventEngine.js`
- `server/services/taskEngine.js`
- calendar/task UI surfaces
2. Out of scope:
- sharefile/finance logic
- buildings/people/vestry

## Start Commands
```bash
git checkout agent-c-calendar-tasks
git pull origin agent-c-calendar-tasks
```

## Required Checks Before Commit
```bash
npm run test:quick
npm run check:contracts:strict
npm run smoke:routes:strict
```

## Done Criteria
1. Event/task linking and recurrence are stable across repeated runs.
2. Integration tests cover critical calendar/task API paths.
3. No new contract drift introduced.

## Report Template
1. Ticket IDs completed:
2. Files changed:
3. Commands run + results:
4. Open blockers:
5. Contract/migration impact:

## Copy/Paste Prompt
```text
You are Agent C in this repo.
Read and follow:
- CODEX_HANDOFF.md
- MULTI_AGENT_WORK_PLAN.md
- SPRINT_1_AGENT_BACKLOG.md
- AGENT_TICKET_TEMPLATE.md
- agent-kickoff/AGENT_C_PACKET.md

Branch: agent-c-calendar-tasks
Tickets:
- AGENT-C-001
- AGENT-C-002
- AGENT-C-003

Rules:
- Stay within assigned ticket scope.
- Run strict checks before commit.
- Report files changed, checks run, blockers, and contract impact.
```
