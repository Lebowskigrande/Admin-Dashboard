# UI Interaction Overhaul + Reveal File Reliability (2026-02-26)

## Scope
- Removed hover elevation/lift behavior from shared UI patterns.
- Standardized hover interactions to use border/background/ring emphasis.
- Fixed `Reveal file` reliability by changing Explorer launch strategy.

## Frontend interaction changes
- Added shared interaction tokens in `src/styles/variables.css`:
  - `--interactive-hover-bg`
  - `--interactive-hover-border`
  - `--interactive-hover-shadow`
  - `--interactive-hover-shadow-strong`
- Updated shared/global controls in `src/styles/global.css`:
  - Removed hover translate on data pills and button classes.
  - Kept click feedback as subtle press scale.
- Updated shared card behavior in `src/components/Card.css`:
  - Removed hover lift translate.
  - Switched to highlight/ring hover state.
- Module-level cleanup to remove lingering lift interactions:
  - `src/pages/Dashboard.css`
  - `src/components/Sidebar.css`
  - `src/components/AtAGlance.css`
  - `src/pages/Finance.css`
  - `src/pages/Buildings.css`
  - `src/pages/Calendar.css`
  - `src/pages/People.css`

## Backend reveal-file fix
- Updated `server/routes/finance.js`:
  - `openExplorerSelect(...)` now prefers direct `explorer.exe /select,<path>` execution.
  - `openExplorerFolder(...)` now prefers direct `explorer.exe <folder>` execution.
  - PowerShell path remains as fallback only.
- Reason: reduce path/argument quoting failures seen when file exists but reveal fails.

## Validation
- Build completed: `npm run build` succeeded.
- Existing unrelated warning remains in `src/pages/buildings/BuildingsMap.jsx` about JSX `>` token.

## Notes
- Commit intentionally scoped to interaction consistency + reveal-file reliability only.
- Other in-progress repo changes were left untouched.
