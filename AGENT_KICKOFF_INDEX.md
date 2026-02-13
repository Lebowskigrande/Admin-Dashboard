# Agent Kickoff Index

Use this folder to launch and coordinate multi-agent execution.

## Prerequisites
1. Base branch is `new-db-schema` at commit `fda660a` or later.
2. Local hooks enabled:
```bash
npm run setup:hooks
```
3. Baseline checks pass:
```bash
npm run test:quick
npm run check:contracts:strict
npm run smoke:routes:strict
```

## Kickoff Files
1. Coordinator: `agent-kickoff/COORDINATOR_PACKET.md`
2. Agent A: `agent-kickoff/AGENT_A_PACKET.md`
3. Agent B: `agent-kickoff/AGENT_B_PACKET.md`
4. Agent C: `agent-kickoff/AGENT_C_PACKET.md`
5. Agent D: `agent-kickoff/AGENT_D_PACKET.md`
6. Agent E: `agent-kickoff/AGENT_E_PACKET.md`
7. Agent F: `agent-kickoff/AGENT_F_PACKET.md`
8. Agent G: `agent-kickoff/AGENT_G_PACKET.md`

## Suggested Launch Order
1. Launch Coordinator (this instance).
2. Launch Agent F (Platform).
3. Launch Agent G (Integration).
4. Launch Agents A-E after Platform confirms baseline policy changes.

## Shared Rules
1. Every agent must read:
- `CODEX_HANDOFF.md`
- `MULTI_AGENT_WORK_PLAN.md`
- `SPRINT_1_AGENT_BACKLOG.md`
- `AGENT_TICKET_TEMPLATE.md`
2. Every agent must stay within assigned ticket scope.
3. Every agent must run before commit:
```bash
npm run test:quick
npm run check:contracts:strict
npm run smoke:routes:strict
```
4. Every PR summary must include:
- files changed
- commands run + results
- open blockers
- contract/migration impact

## Agent Report Scaffold Example
```powershell
.\scripts\agent-report.ps1 `
  -Agent "f" `
  -Tickets "AGENT-OPS-001","AGENT-OPS-002" `
  -Branch "agent-f-platform-quality" `
  -Head "abc1234" `
  -Checks "npm run test:quick (pass)","npm run check:contracts:strict (pass)","npm run smoke:routes:strict (pass)" `
  -Notes "No blockers"
```
