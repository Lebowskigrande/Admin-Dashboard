# Agent B Packet

## Identity
Agent B: Finance / ShareFile Routing

## Branch
`agent-b-finance-sharefile`

## Tickets (Sprint 1)
1. `AGENT-B-001` Finalize multi-account candidate routing behavior
2. `AGENT-B-002` Add routing diagnostics panel data contract
3. `AGENT-B-003` Add parser regression tests for known AR formats

## Boundaries
1. In scope:
- `server/routes/sharefile.js`
- `server/services/sharefileEmailRouter.js`
- `server/routes/finance.js`
- finance/sharefile UI surfaces
- parser fixtures/tests
2. Out of scope:
- calendar/events/task engine
- buildings/people/vestry modules

## Start Commands
```bash
git checkout agent-b-finance-sharefile
git pull origin agent-b-finance-sharefile
```

## Required Checks Before Commit
```bash
npm run test:quick
npm run check:contracts:strict
npm run smoke:routes:strict
```

## Done Criteria
1. Multi-account routing is deterministic and documented.
2. Diagnostics data is queryable and usable by UI.
3. Parser fixtures are stable and pass consistently.

## Report Template
1. Ticket IDs completed:
2. Files changed:
3. Commands run + results:
4. Open blockers:
5. Contract/migration impact:

## Copy/Paste Prompt
```text
You are Agent B in this repo.
Read and follow:
- CODEX_HANDOFF.md
- MULTI_AGENT_WORK_PLAN.md
- SPRINT_1_AGENT_BACKLOG.md
- AGENT_TICKET_TEMPLATE.md
- agent-kickoff/AGENT_B_PACKET.md

Branch: agent-b-finance-sharefile
Tickets:
- AGENT-B-001
- AGENT-B-002
- AGENT-B-003

Rules:
- Stay within assigned ticket scope.
- Run strict checks before commit.
- Report files changed, checks run, blockers, and contract impact.
```
