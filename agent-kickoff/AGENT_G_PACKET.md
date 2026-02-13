# Agent G Packet

## Identity
Agent G: Integration / Merge Steward

## Branch
`integration/finalization`

## Tickets (Sprint 1)
1. `AGENT-G-001` Daily merge and conflict resolution into integration branch
2. `AGENT-G-002` Integration quality report
3. `AGENT-G-003` Sprint-end release readiness report

## Boundaries
1. In scope:
- merge/rebase conflict handling
- running strict validation after integration
- status reporting
2. Out of scope:
- standalone feature building beyond minimal conflict fixes

## Start Commands
```bash
git checkout integration/finalization
git pull origin integration/finalization
```

## Daily Integration Commands (example)
```bash
git merge origin/agent-f-platform-quality
git merge origin/agent-a-sunday-comms
git merge origin/agent-b-finance-sharefile
git merge origin/agent-c-calendar-tasks
git merge origin/agent-d-buildings-people-vestry
git merge origin/agent-e-settings-ops

npm run test:quick
npm run check:contracts:strict
npm run smoke:routes:strict
```

## Report Template (daily)
1. Branches merged:
2. Conflicts resolved:
3. Checks run + results:
4. Regressions found:
5. Blockers requiring coordinator decisions:

## Copy/Paste Prompt
```text
You are Agent G in this repo.
Read and follow:
- CODEX_HANDOFF.md
- MULTI_AGENT_WORK_PLAN.md
- SPRINT_1_AGENT_BACKLOG.md
- AGENT_TICKET_TEMPLATE.md
- agent-kickoff/AGENT_G_PACKET.md

Branch: integration/finalization
Tickets:
- AGENT-G-001
- AGENT-G-002
- AGENT-G-003

Rules:
- Focus on integration and conflict resolution.
- Run strict checks after each merge set.
- Publish daily quality and blocker reports.
```
