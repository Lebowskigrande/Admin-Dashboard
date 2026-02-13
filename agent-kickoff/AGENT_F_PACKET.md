# Agent F Packet

## Identity
Agent F: Platform / Quality

## Branch
`agent-f-platform-quality`

## Tickets (Sprint 1)
1. `AGENT-F-001` Remove duplicate router mounts and normalize API mount policy
2. `AGENT-F-002` Establish lint baseline policy and fix P0 lint issues
3. `AGENT-F-003` Add startup environment validation

## Boundaries
1. In scope:
- server bootstrap/app/routing policy
- lint config + quality checks
- startup env validation layer
- shared scripts for hygiene gates
2. Out of scope:
- deep feature behavior changes unless required for platform fixes

## Start Commands
```bash
git checkout agent-f-platform-quality
git pull origin agent-f-platform-quality
```

## Required Checks Before Commit
```bash
npm run test:quick
npm run check:contracts:strict
npm run smoke:routes:strict
```

## Done Criteria
1. Route mount policy is documented and enforced.
2. P0 lint/parser blockers are removed in target scope.
3. Startup fails fast for missing required env variables.

## Report Template
1. Ticket IDs completed:
2. Files changed:
3. Commands run + results:
4. Open blockers:
5. Contract/migration impact:

## Copy/Paste Prompt
```text
You are Agent F in this repo.
Read and follow:
- CODEX_HANDOFF.md
- MULTI_AGENT_WORK_PLAN.md
- SPRINT_1_AGENT_BACKLOG.md
- AGENT_TICKET_TEMPLATE.md
- agent-kickoff/AGENT_F_PACKET.md

Branch: agent-f-platform-quality
Tickets:
- AGENT-F-001
- AGENT-F-002
- AGENT-F-003

Rules:
- Stay within assigned ticket scope.
- Run strict checks before commit.
- Report files changed, checks run, blockers, and contract impact.
```
