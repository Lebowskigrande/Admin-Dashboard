# St. Edmund's Admin Dashboard

A comprehensive dashboard for Church Administration, built with React and Vite.

## Features
- **Finance**: Track Expenses and Deposits (Accounts Payable/Receivable).
- **Calendar**: Manage Events, contracts, payments, and staffing.
- **Buildings & Ops**: Track repairs, long-term needs, and preferred vendors.
- **People**: Manage timesheets, volunteer rosters, and ministry groups.
- **Sunday Planner**: Bulletin workflow and Sunday service operations.
- **Settings/Ops**: Integration readiness, sync health, and audited admin actions.

## Getting Started

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Run Locally**
    Open two terminals:
    ```bash
    npm run dev:server
    ```

    ```bash
    npm run dev:client
    ```

3.  **Build for Production**
    ```bash
    npm run build
    ```

## Runtime Configuration

The API validates environment configuration on startup. In production (`NODE_ENV=production`) missing required integration settings fail startup with actionable errors.

Recommended/required env vars for production readiness:
- `CLIENT_ORIGIN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `SHAREFILE_GOOGLE_REDIRECT_URI` (or derived from `GOOGLE_REDIRECT_URI`)
- `CC_CLIENT_ID`
- `CC_CLIENT_SECRET`
- `CC_REDIRECT_URI`
- `DB_BACKUP_DIR` (absolute path, should exist)
- `DROPBOX_ROOT` (absolute path, should exist)
- `SHAREFILE_ROUTER_BASES` (JSON object with `budget` and/or `envelope` absolute paths)

The Settings page reads `/api/ops/status` and surfaces:
- config validation errors/warnings
- service readiness (Google, ShareFile, Constant Contact)
- sync status (Google events, ShareFile routing)
- recent admin action logs

## Engineering Hygiene

1.  **Quick local checks**
    ```bash
    npm run hygiene:quick
    ```

2.  **Route/API contract report**
    ```bash
    npm run check:contracts
    ```
    Strict mode:
    ```bash
    npm run check:contracts:strict
    ```

3.  **Route/navigation smoke check**
    ```bash
    npm run smoke:routes
    ```
    Strict mode:
    ```bash
    npm run smoke:routes:strict
    ```

4.  **Enable repo git hooks**
    ```bash
    npm run setup:hooks
    ```

5.  **Database snapshot helpers for testing**
    ```bash
    npm run test:db:save
    npm run test:db:restore
    ```

## Platform Notes

1.  **Startup environment validation**
    - Server boot now validates env consistency via `server/env.js`.
    - Optional integrations may be fully unset in local/dev.
    - Partial OAuth/integration config fails fast with a clear error list.
    - `NODE_ENV=production` requires `CLIENT_ORIGIN`.
    - `SERVER_PORT` must be numeric when provided.

2.  **Lint baseline vs strict**
    - `npm run lint` runs baseline lint and allows existing warning backlog.
    - `npm run lint:strict` enforces zero warnings (`--max-warnings=0`) and is expected to fail until warning backlog is reduced.

## Agent Scripts

1. **Sync any worktree branch**
   ```powershell
   .\scripts\agent-sync.ps1 -RepoPath "C:\Users\Secretary\Documents\AdminDashboard-F" -Branch "agent-f-platform-quality"
   ```

## Ops Runbook

See `docs/ops-runbook.md` for startup/recovery procedures and known failure modes with fixes.

