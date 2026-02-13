# Settings/Ops Runbook

## Startup Checklist
1. Ensure dependencies are installed: `npm install`.
2. Ensure `server/.env` is populated with required production settings.
3. Start backend: `npm run dev:server`.
4. Start frontend: `npm run dev:client`.
5. Open Settings and verify `Operations Readiness` reports `Ready`.

## Required Environment Settings
- `CLIENT_ORIGIN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `SHAREFILE_GOOGLE_REDIRECT_URI` (or valid `GOOGLE_REDIRECT_URI` fallback)
- `CC_CLIENT_ID`
- `CC_CLIENT_SECRET`
- `CC_REDIRECT_URI`

## Path/Filesystem Settings
- `DB_BACKUP_DIR`: absolute path to backup directory.
- `DROPBOX_ROOT`: absolute path for local Dropbox root.
- `SHAREFILE_ROUTER_BASES`: JSON object with absolute folder paths.
  - Example: `{"budget":"Y:\\Folders\\...\\AP","envelope":"Y:\\Folders\\...\\AR"}`

## Safe Admin Actions
Risky operations require explicit confirmation phrases and are logged in `admin_action_logs`:
- DB restore: `RESTORE DATABASE`
- Dev restart: `RESTART SERVICES`
- ShareFile bulk route: `ROUTE SHAREFILE NOW`

Review recent actions in Settings > Operations Readiness > Recent Admin Actions.

## Recovery Steps
1. Config issues:
   - Check Settings > Configuration Validation.
   - Fix missing/malformed env vars and restart server.
2. Google disconnected:
   - Reconnect in Settings > Google Calendar Integration.
   - Run manual sync if needed.
3. ShareFile routing stalled:
   - Verify ShareFile account is linked and defaulted.
   - Verify `SHAREFILE_ROUTER_BASES` target folders are reachable.
   - Use `Run ShareFile Routing Now` in Settings for manual recovery.
4. Backup restore:
   - Trigger restore from People page with confirmation phrase.
   - Service exits after restore; restart server.

## Known Failure Modes + Fixes
1. `Configuration validation failed` at startup:
   - Cause: Missing required production env vars.
   - Fix: Add missing env vars listed in startup error and restart.
2. `SHAREFILE_ROUTER_BASES is not valid JSON`:
   - Cause: Invalid escaping in Windows path JSON.
   - Fix: Escape backslashes (`\\`) or use quoted fallback format exactly.
3. `No Gmail tokens configured for ShareFile extension`:
   - Cause: No linked ShareFile routing account.
   - Fix: Link account in Settings and set a default routing account.
4. `Restart not allowed`:
   - Cause: Restart endpoint called from non-local IP or production mode.
   - Fix: Use local dev environment; avoid restart endpoint in production.
5. `Invalid backup path` during restore:
   - Cause: Restore target not under `DB_BACKUP_DIR`.
   - Fix: Use latest backup endpoint output and keep `DB_BACKUP_DIR` correct.
