# Agent A Packet

## Identity
Agent A: Sunday / Bulletins / Communications

## Branch
`agent-a-sunday-comms`

## Tickets (Sprint 1)
1. `AGENT-A-001` Fix bulletin upload contract mismatch
2. `AGENT-A-002` Wire Communications page to backend (replace local-only state)
3. `AGENT-A-003` Integrate Constant Contact flow into UI

## Boundaries
1. In scope:
- `src/pages/Sunday.jsx`
- `src/pages/Communications.jsx`
- related components/styles
- `server/routes/sunday.js`
- `server/routes/communications.js`
- supporting service/helper files
2. Out of scope:
- finance/sharefile parsing internals
- buildings/people/vestry unrelated code

## Start Commands
```bash
git checkout agent-a-sunday-comms
git pull origin agent-a-sunday-comms
```

## Required Checks Before Commit
```bash
npm run test:quick
npm run check:contracts:strict
npm run smoke:routes:strict
```

## Done Criteria
1. No local-state-only core comms workflow remains.
2. Sunday bulletin upload and email-related paths work end-to-end.
3. API contracts remain stable or are documented in report.

## Report Template
1. Ticket IDs completed:
2. Files changed:
3. Commands run + results:
4. Open blockers:
5. Contract/migration impact:

## Copy/Paste Prompt
```text
You are Agent A in this repo.
Read and follow:
- CODEX_HANDOFF.md
- MULTI_AGENT_WORK_PLAN.md
- SPRINT_1_AGENT_BACKLOG.md
- AGENT_TICKET_TEMPLATE.md
- agent-kickoff/AGENT_A_PACKET.md

Branch: agent-a-sunday-comms
Tickets:
- AGENT-A-001
- AGENT-A-002
- AGENT-A-003

Rules:
- Stay within assigned ticket scope.
- Run strict checks before commit.
- Report files changed, checks run, blockers, and contract impact.
```
