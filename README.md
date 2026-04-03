# St. Edmund's Admin Dashboard

This dashboard is the operating system for parish administration. It is not just a reporting tool. It is meant to hold the live state of worship planning, events, vestry preparation, buildings work, finance work, and recurring operations in one place so the next actionable work is always visible.

This README has two jobs:

1. Explain how to use the dashboard in real day-to-day work.
2. Act as a living instruction document you can edit when you want the app changed.

## Core Idea

The app is now organized around work packages rather than isolated tasks.

A work package is one real operational outcome, for example:

- `Sunday, Apr 5 Service Planning`
- `Great Vigil of Easter Event Planning`
- `April Vestry Cycle`
- `Weekly Operations`

Each package contains sections such as:

- `Bulletin`
- `Insert`
- `Music`
- `Roster`
- `Finance`
- `Comms`
- `Setup`
- `Follow-up`

Each section contains the actual checklist items or status-based tasks.

The goal is:

- Keep the interface clean.
- Keep recurring defaults out of the queue unless they actually need attention.
- Show the whole shape of the work at a glance.
- Reduce unnecessary clicks.

## How To Use The Dashboard

### Overview

Use the **Overview** page as the cockpit.

This page is for:

- seeing the current operational picture across the platform
- spotting overdue or risky work quickly
- jumping into the next package that needs attention
- checking system/integration health

The **Focus Queue** is the most important area on this page. It should show the next meaningful work packages, not a spray of tiny tasks.

Use Overview when you want to answer:

- What matters right now?
- What is close to slipping?
- Which package should I open next?

### To Do

Use the **To Do** page as the working board.

This is where you:

- work through active packages
- open one section at a time in the focus tray
- mark status-style items as started or done
- add notes to the current action

The left side is the workboard. The right side is the focus tray.

Use To Do when you want to answer:

- What exactly do I need to do next?
- How far along is this package?
- What section is holding this work up?

### Calendar

Use the **Calendar** page to manage the actual event or service record.

This is where you:

- confirm event/service date, time, and location
- manage worship planning details
- manage event-specific details
- upload bulletins, contracts, and supporting files
- review event-linked tasks

For worship services, Calendar is the planning record.
For non-worship events, Calendar is the logistics record.

### Liturgical Schedule

Use **Liturgical Schedule** for the Sunday roster itself.

This is where you:

- assign readers and liturgical ministers
- confirm who is serving on which Sunday
- manage the built-in Sunday service role structure

This module should hold the main Sunday staffing truth.
The task engine should only surface exceptions or real planning work that remains outside the normal schedule.

### Sunday

Use **Sunday** for the broader Sunday communications and service-prep workflow.

This is where you:

- manage Sunday-specific planning
- track bulletin/insert/comms progress
- review service readiness in one place

This module overlaps with Calendar and Liturgical Schedule, but its role is broader Sunday coordination rather than just the event record or roster.

### Vestry

Use **Vestry** for the monthly vestry cycle.

This is where you:

- review the upcoming or previous vestry meeting
- manage packet assembly
- track certificates and follow-up
- keep vestry-specific work out of the generic task clutter

The vestry cycle should appear in To Do and Overview as one package with clear sections, not as disconnected checklist fragments.

### Finance

Use **Finance** for accounts payable, deposits, and related financial admin.

This is where you:

- code and review expenses
- manage deposits and financial processing work
- support vestry packet financial material

Finance tasks should roll up cleanly into operational packages when they are part of weekly work, and remain visible as finance work when they are standalone.

### Buildings & Grounds

Use **Buildings & Grounds** for maintenance, repairs, vendors, tickets, and records.

This is where you:

- track active building issues
- manage vendors and records
- identify longer-range facilities needs

### People

Use **People** as the people/roles directory.

This is where you:

- manage staff and volunteers
- maintain role eligibility
- support liturgical assignments and ministry work

### Settings

Use **Settings** to manage integrations and application-level behavior.

This is where you:

- connect Google Calendar
- choose synced calendars
- review integration configuration

## How The App Fits Into The Workflow

### Daily Rhythm

A normal day should look like this:

1. Open **Overview**.
2. Check the Focus Queue and exception areas.
3. Open the most urgent package in **To Do**.
4. Work one section at a time.
5. Open **Calendar**, **Finance**, **Buildings**, or another module only when the package needs deeper edits.

The app should support this rhythm without making you hunt for context.

### Weekly Rhythm

A normal week should roughly break down like this:

- **Weekly Operations**: recurring parish admin, finance processing, communications, and other weekly office work
- **Sunday Planning**: bulletin, insert, roster, music, and communications for the next Sunday
- **Events**: planning for special services and other scheduled events
- **Vestry**: only when the monthly cycle is active
- **Buildings**: as needed for active issues and follow-up

The queue should reflect current operational reality, not every seeded future task in the database.

### Defaults And Exceptions

The app is designed around the idea that most church work repeats.

That means:

- defaults should be pre-filled
- recurring assumptions should stay invisible unless broken
- only exceptions should show up as queue noise

Examples:

- If Rob is the normal organist, that should stay assigned by default.
- If a midweek service requires no weekly upkeep, it should not surface in the queue.
- If a rental field is irrelevant, it should stay hidden until the event becomes a rental.

## Current Planning Rules

These are the current operating assumptions built into the app.

### 8am Rite I

- Rob Hovencamp is the default organist.
- No other regular music role is required by default.
- Celebrant and preacher should normally inherit from the 10am service unless manually changed.
- One lector is needed.
- Bulletin is required.
- No insert is required.
- Music should only surface as work if the default organist has been removed.

### 10am Rite II

- Rob Hovencamp is the default organist.
- St. Edmund's Choir is included by default except during summer months.
- The full liturgical roster lives in Liturgical Schedule.
- Bulletin and insert are required.
- Music should only surface as work if the default organist has been removed.

### Other Worship Services

- Clergy is required, but the exact role/number is flexible.
- Liturgical roles are addable, not pre-filled.
- Music is blank by default.
- Bulletin is required.

### Other Events

- Minimal default fields only.
- Core fields should stay lightweight.
- Rental-related fields should appear only when relevant.
- Contract handling should not clutter non-rental events.

## What "Good" Looks Like

The app is working well when:

- Overview tells you what matters in under a minute.
- To Do shows packages, not clutter.
- Section labels are concrete and easy to scan.
- Defaults remove routine work from the queue.
- Calendar holds the detailed planning record without forcing every detail into the queue.
- The queue reflects active operational work, not future noise or internal data structure artifacts.

## How To Request App Changes By Editing This File

You can edit this README as a briefing document for future changes.

When you want the app changed, update one or more of the sections below and tell me to implement the README edits.

Use plain English. Short notes are fine.

### Change Request Template

Copy and edit this block whenever you want to drive a new round of app changes:

```md
## Change Request

### Problem
- What feels wrong?
- Where does it happen?
- What is the operational cost?

### Desired Outcome
- What should the app let you do instead?
- What should become faster, clearer, or less cluttered?

### Real Workflow
- What do you actually do in real life?
- What defaults usually hold?
- What is an exception rather than the norm?

### UI / Naming Notes
- What words are wrong?
- What should cards, sections, or buttons say instead?
- What should be hidden unless needed?

### Rules
- List concrete rules.
- Example: "Rite II should include choir by default except June-August."
- Example: "Do not show contract slot unless rental is true."

### Priority
- High / Medium / Low

### Acceptance Test
- How will we know the change is correct?
- What should you see on screen after the fix?
```

### Working Sections You Can Edit Directly

You can also edit these sections directly:

- `Current Planning Rules`
- `What "Good" Looks Like`
- `Daily Rhythm`
- `Weekly Rhythm`

If you change those sections, I can treat the edits as product direction and update the app to match.

## Notes For Future Iteration

Areas that still deserve ongoing refinement:

- naming quality for work packages and sections
- reducing clutter from recurring operational work
- making exceptions more visible than defaults
- improving visual scanability for spatial/visual thinking
- tightening integration between Overview, To Do, Calendar, Sunday, and Liturgical Schedule

## Local Development

### Install

```bash
npm install
```

### Run

Use two terminals:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

### Build

```bash
npm run build
```

### Test

```bash
npm test -- --runInBand
```

### Additional Checks

```bash
npm run check:contracts
npm run smoke:routes
```

## Implementation Note

If you edit this README and want the app updated to match it, say:

`Implement the README edits.`

I will treat the README changes as instructions, compare them against the current app behavior, and update the code accordingly.
