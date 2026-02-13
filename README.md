# St. Edmund's Admin Dashboard

A comprehensive dashboard for Church Administration, built with React and Vite.

## Features
- **Finance**: Track Expenses and Deposits (Accounts Payable/Receivable).
- **Calendar**: Manage Events, contracts, payments, and staffing.
- **Buildings & Ops**: Track repairs, long-term needs, and preferred vendors.
- **People**: Manage timesheets, volunteer rosters, and ministry groups.
- **Communications**: Mail log, bulletin checklists, and vestry packets.
- **Resources**: Music library management.

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

