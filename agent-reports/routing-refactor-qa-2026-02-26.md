# Routing Refactor QA Run (2026-02-26)

Command:
`node scripts/qa-routing-log-refactor.js`

Summary:
- Pass: 5
- Fail: 0

Flow executed (synthetic seeded AP route):
1. Initial routing log read found seeded job.
2. Reroute #1 via `/api/deposit-slip/routing-log/ap-entry`:
   - `renamedFiles=1`
   - `deletedFiles=1`
3. Reveal via `/api/deposit-slip/routing-log/reveal`:
   - Endpoint returned explorer-open failure in this non-GUI sandbox.
   - Marked as expected environment limitation.
4. Reroute #2 via same endpoint:
   - `renamedFiles=1`
   - `deletedFiles=0`
5. DB consistency checks:
   - `sharefile_jobs.code_value` ended as `QA-CODE-3`
   - Canonical `output_json.files` length is `1`
   - `output_json.routing.history` contains `2` `ap-entry-update` actions.

Notes:
- Harness seeds and then cleans up test rows/files.
- Script path: `scripts/qa-routing-log-refactor.js`.
