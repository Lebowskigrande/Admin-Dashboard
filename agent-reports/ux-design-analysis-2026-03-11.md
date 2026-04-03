# UX Design Analysis - Admin Dashboard

Date: 2026-03-11

## Scope reviewed
- Global shell and navigation
- Dashboard overview
- Tasks / task origin workflow
- People workspace
- Finance workspace
- Existing concept mockups in `public/mockups`

## What is working
- The product already has strong domain segmentation. Sunday, calendar, finance, buildings, people, vestry, and task admin are clearly separated.
- Reusable patterns exist across the app: cards, pills, split panels, detail panes, and filter chips.
- Several pages already use a "queue + detail" model, which is the right interaction shape for admin work.
- Existing concept files show prior intent toward a more operational, cockpit-style experience instead of a simple CRUD dashboard.

## Main UX issues

### 1. The shell is structurally clear but cognitively heavy
- The fixed left rail exposes many top-level destinations with equal weight.
- Long labels and a single long list make scanning slower than it should be.
- There is no strong concept of grouped work modes such as Command, Planning, Records, and Systems.

### 2. The visual hierarchy is too even
- Many surfaces are white or near-white cards with similar border treatment.
- Critical items, informative items, and passive metadata often share the same visual weight.
- Urgency is mostly communicated through small pills, which forces reading instead of recognition.

### 3. Too much vertical real estate is spent on framing
- Page headers, card padding, and stacked chips consume height before the user reaches the working data.
- Multiple pages create nested scroll regions, which hurts orientation and increases pointer travel.
- The UI reads as careful and clean, but not especially fast.

### 4. Data density is moderate, not operational
- The dashboard shows counts, but not enough actionable linkage between modules.
- Task and record-heavy pages still behave like card lists more than workbench interfaces.
- Dense admin users need frozen context, inline actions, quick triage states, and compact row rhythms.

### 5. Cross-module context is underexposed
- A Sunday issue can affect people, communications, finance, and facilities, but the interface largely presents those as separate destinations.
- The current overview page is more of a summary page than a command center.
- There is no strong "what needs me now" layer cutting across origins.

### 6. Interaction design is mostly select-and-read
- Many screens emphasize selection and inspection, but fewer support immediate next-step actions.
- There is little evidence of a command surface, shortcut model, drawer-driven workflows, or bulk triage patterns.
- Hover, motion, and state transitions are present but subtle enough that the app still feels static.

## Recommended redesign direction

### Information architecture
- Group navigation into four bands: Command, Planning, Records, Systems.
- Add a command/search surface for "jump to task, person, event, vendor, or document".
- Promote favorites / recents / pinned workflows so frequent tasks do not require full navigation.

### Layout model
- Adopt a workbench pattern for dense pages: queue on the left, primary work surface in the center, context or automation panel on the right.
- Reduce redundant page framing and use sticky context rows instead of repeated card headers.
- Reserve large hero treatment for the command center only; keep work pages tighter and faster.

### Visual system
- Keep the parish blue and gold cues, but move to deeper contrast, stronger surfaces, and clearer semantic color lanes.
- Use a more distinctive heading face and tighter data typography.
- Replace many pills with row tinting, edge markers, progress bars, and grouped metadata.

### Data display
- Introduce density modes: comfortable, compact.
- Use columnar lists for operational queues and sticky headers for record-heavy surfaces.
- Show related-object context inline: origin, owner, due signal, dependency, and next action.

### Interaction model
- Add side drawers for "details without leaving the list".
- Enable one-click next actions on task rows.
- Use segmented views for Command / Sunday / Finance / People context shifts.
- Add motion to reinforce state change, not decorate the screen.

## Screen-level recommendations

### Overview -> Operations Command Center
- Replace simple KPI cards with readiness bands, blocker clusters, and owner-aware action queues.
- Surface cross-module signals in one place: Sunday readiness, finance exceptions, people conflicts, buildings issues.
- Make the dashboard answer three questions immediately:
  - What is at risk?
  - What is due today?
  - What can be resolved in one click?

### Tasks -> Workflow Workbench
- Keep the queue + detail model, but compress the queue and make the active workflow denser.
- Promote "next step" actions into the main pane.
- Use inline progress bars, structured columns, and contextual shortcuts to origin pages.

### People / Finance -> Record Grid System
- Shift from soft card stacks toward sharper, denser grid views with sticky headers and inline chips.
- Add persistent filter rails and summary strips that remain visible while scrolling.
- Unify row behavior so every row exposes the same mental model: identity, status, related entities, actions.

## Existing design-concept files worth keeping in mind
- `public/mockups/ux-cockpit-concept.html`
- `public/mockups/task-list-ux-revamp.html`
- `public/mockups/task-engine-ux-revamp.html`

They point in the right direction: more operational rhythm, stronger hierarchy, and better workflow framing. The next step is to unify those ideas into one coherent system rather than treating them as isolated page concepts.
