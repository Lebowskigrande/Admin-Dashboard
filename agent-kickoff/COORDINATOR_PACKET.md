# Coordinator Packet

## Role
You are the coordinator for all agents. You do not take large feature tickets unless needed for unblock.

## First Actions
1. Ensure clean baseline:
```bash
git checkout new-db-schema
git pull origin new-db-schema
npm run test:quick
npm run check:contracts:strict
npm run smoke:routes:strict
```
2. Create/verify agent branches:
```bash
git checkout -b agent-a-sunday-comms new-db-schema
git checkout -b agent-b-finance-sharefile new-db-schema
git checkout -b agent-c-calendar-tasks new-db-schema
git checkout -b agent-d-buildings-people-vestry new-db-schema
git checkout -b agent-e-settings-ops new-db-schema
git checkout -b agent-f-platform-quality new-db-schema
git checkout -b integration/finalization new-db-schema
git checkout new-db-schema
```
3. Push branches:
```bash
git push -u origin agent-a-sunday-comms
git push -u origin agent-b-finance-sharefile
git push -u origin agent-c-calendar-tasks
git push -u origin agent-d-buildings-people-vestry
git push -u origin agent-e-settings-ops
git push -u origin agent-f-platform-quality
git push -u origin integration/finalization
```

## Coordination Workflow
1. Assign tickets exactly as listed in `SPRINT_1_AGENT_BACKLOG.md`.
2. Require every agent report with:
- ticket IDs
- files touched
- checks run/results
- blockers
3. Merge only after strict checks pass.
4. Merge order:
- Platform F first when shared config/bootstrap/routing changes.
- Then feature agents.
- Integration G continuously revalidates `integration/finalization`.

## Daily Cadence Template
1. Collect reports from A-G.
2. Update status table:
- `ticket`, `agent`, `state`, `risk`, `next action`
3. Resolve conflicts and re-run:
```bash
npm run test:quick
npm run check:contracts:strict
npm run smoke:routes:strict
```

## Copy/Paste Prompt (for coordinator instance)
```text
You are the coordinator agent for this repo.
Read and follow:
- CODEX_HANDOFF.md
- MULTI_AGENT_WORK_PLAN.md
- SPRINT_1_AGENT_BACKLOG.md
- AGENT_TICKET_TEMPLATE.md
- AGENT_KICKOFF_INDEX.md
- agent-kickoff/COORDINATOR_PACKET.md

Your job:
- Create and manage agent branches.
- Enforce ticket scope and merge gates.
- Keep integration branch green.
- Produce daily status + blockers list.
```
