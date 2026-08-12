# RACK HUB Roadmap

## Current status

**Current milestone:** M2 — Frontend / Backend / Engine Separation  
**Status:** IN PROGRESS

**Current objective:** create clean architectural boundaries — extract BBS/domain calculations from large React components, establish an explicit backend/API boundary, and make backend-held tournament state authoritative — while preserving the M1 regression baseline.

**Previous milestone:** M1 — BBS Baseline Reproduction — **COMPLETE**.

**Next milestone:** M3 — Live Broadcasting Skeleton.

---

## M0 — Project Foundation

**Status:** COMPLETE

### Goal

Replicate the existing React frontend application as a proper, conventional software project under Git.

The legacy application may remain monolithic during this milestone. Correct migration is more important than refactoring.

### Scope

- normal Node/Vite/React project structure;
- working local development command;
- working production build;
- immutable legacy reference source;
- readable README and project documentation;
- dependency setup required by the existing application.

### Out of scope

- redesigning the UI;
- changing BBS behavior;
- extracting the engine;
- adding a backend;
- adding live pages;
- Canaletto-specific functionality.

### Acceptance criteria

- `npm install` succeeds;
- `npm run dev` launches the existing application locally;
- `npm run build` succeeds;
- the legacy source remains unchanged;
- existing major application features remain present;
- another developer can understand how to launch the project from the README.

---

## M1 — BBS Baseline Reproduction

**Status:** COMPLETE

### Goal

Prove that RACK HUB can reproduce a tournament that has already been completed.

This becomes the regression baseline that protects the BBS engine during later refactoring.

### Scope

Create a permanent reference-tournament fixture containing, as available:

- entrants and starting GBR values;
- tournament configuration;
- rounds and pairings;
- match results;
- expected final standings;
- expected final ratings/performance values where available.

Replay the reference tournament through the application/engine and compare generated output with the known result.

### Acceptance criteria

- final player order is reproduced with no unexplained differences;
- match points and deterministic rack statistics match exactly;
- pairing/bye behavior matches when replayed from the same state;
- floating-point values such as GBR/PERF match after defined display rounding or an explicitly documented numerical tolerance;
- any unavoidable discrepancy is documented and approved rather than hidden;
- the fixture remains part of the automated regression suite.

See `TESTING.md`.

### Outcome

M1 delivered a baseline safety net rather than a single historical full-tournament
replay:

- three historical tournament CSVs preserved as immutable source evidence, with
  normalized fixtures and data-integrity tests for 14.1, 9-ball, and 10-ball, plus
  manual 14.1 compatibility validation;
- stable fixed-rack BBS logic (expected score, GBR, PERF, match points, standings,
  standard pairing, byes, recalculation) extracted into a small pure-function
  module (`src/domain/fixedRackBbs.js`), covered by focused automated tests and a
  deterministic synthetic replay fixture, and independently reviewed by a second
  agent;
- Classic standings corrected to the whitepaper rule (`MP -> PERF -> ID`); Rack
  standings (`MP -> RD -> PERF -> ID`) and standard pairing (`MP -> PERF -> ID`)
  confirmed unchanged;
- experimental 14.1 behavior remains isolated from stable fixed-rack behavior;
- `npm test` passes 11/11 and `npm run build` passes.

A full historical reference-tournament golden master (literal replay-and-compare
against one completed event's final standings) was not required to close M1; see
`TESTING.md`.

---

## M2 — Frontend / Backend / Engine Separation

**Status:** IN PROGRESS

### Goal

Create clean architectural boundaries so local development and future internet deployment use the same conceptual system.

### Target model

```text
Frontend UI  <---->  Backend/API  <---->  Persistence
    |
    v
Domain / BBS engine (pure deterministic logic)
```

The exact implementation may differ, but the boundaries are mandatory.

### Scope

- extract BBS/domain calculations from large React components;
- establish an explicit backend/API boundary;
- make backend-held tournament state authoritative;
- keep frontend responsible for interaction/presentation rather than tournament mathematics;
- preserve M1 regression behavior.

### Acceptance criteria

- domain calculations can execute without React;
- frontend reads/writes tournament state through a defined interface/API;
- refreshing the frontend does not define or destroy authoritative tournament state;
- M1 regression suite passes;
- architecture documentation matches the implemented system.

---

## M3 — Live Broadcasting Skeleton

### Goal

Build the pages and data flow that need to update live, initially on localhost.

### Initial target routes

- `/admin`
- `/live`
- `/overlay/match`
- `/overlay/standings`

Bracket routes can be introduced with M4.

### Scope

- admin changes authoritative backend state;
- public/live page reads the same state;
- OBS/browser-source pages read the same state;
- simple polling is acceptable initially;
- refresh/reload preserves state.

### Acceptance test

1. Open `/admin`.
2. Record a match as 5–3.
3. Backend stores the result.
4. `/live` shows 5–3.
5. match overlay shows 5–3.
6. standings reflect the result.
7. Correct the match to 4–4.
8. all views update without re-entering the score elsewhere.
9. refresh the pages.
10. authoritative state remains intact.

---

## M4 — Canaletto Hybrid Tournament Format

### Goal

Support a reusable multi-stage tournament that begins with BBS Swiss-style group/stage play and advances qualifiers into a Top-N single-elimination bracket.

For the current Canaletto use case, N is 16.

### Scope

- reusable stage model;
- BBS/Swiss-style first stage;
- qualification from first-stage standings;
- configurable Top-N single-elimination stage;
- bracket data model;
- bracket admin workflow;
- public bracket display;
- OBS-friendly bracket display where useful.

### Important design rule

Do not implement Canaletto as scattered `if tournamentName === ...` logic. Model the underlying multi-stage format and express Canaletto as configuration/preset data.

### Acceptance criteria

A test event can progress without spreadsheet intervention through:

```text
registration
   -> BBS stage
   -> final stage standings
   -> Top 16 qualification
   -> generated single-KO bracket
   -> round of 16
   -> quarterfinals
   -> semifinals
   -> final
   -> champion
```

The exact cross-group seeding policy must be documented when agreed; it must not be invented implicitly in code.

---

## M5 — Canaletto Event-Ready Deployment

### Goal

Create the minimum robust production setup required to run the real tournament.

### Operating model

The tournament director runs/administers RACK HUB locally. Match results are initially read from BillardPad and entered manually into RACK HUB. RACK HUB publishes the resulting live state to internet-facing pages.

### Event-critical UI

Every active match should support very fast manual score changes, including direct rack controls such as:

```text
Player A                 Player B
[-]  4  [+]              [-]  3  [+]
```

Corrections must be as easy as additions.

### Scope

- reliable local admin operation;
- public internet live score/standings pages;
- public bracket page;
- OBS/browser views;
- quick `+1` / `-1` rack controls on active matches;
- clear match completion workflow;
- durable tournament state;
- export/backup procedure;
- recovery procedure tested before the event.

### Acceptance criteria

- tournament admin runs reliably on the tournament machine;
- a score entered locally appears on a public device using another network;
- standings and bracket update correctly;
- OBS pages work as browser sources;
- rack entry/correction is fast enough for one manual operator;
- application restart or browser refresh does not lose authoritative state;
- backups and exports can reconstruct the event if necessary;
- a complete rehearsal tournament succeeds before event day.

Automated BillardPad integration is explicitly **not required** for M5.

---

## M6 — Reusable RACK HUB Platform

### Goal

Generalize the event-ready application into a reusable tournament platform.

### Target capabilities

- create new tournaments;
- choose tournament formats and presets;
- configure BBS parameters cleanly;
- reuse hybrid BBS + knockout structures;
- manage multiple events over time;
- central public page for current live tournaments;
- permanent archive of completed tournaments;
- persistent player and GBR history.

### Acceptance direction

RACK HUB should no longer require code changes to create an ordinary tournament that fits an existing supported format/preset.

---

## M7+ — Integrations and Expansion

### FUTURE candidates

- BillardPad result integration;
- player-facing score submission;
- authentication and multiple tournament directors;
- richer player profiles and rating history;
- additional cue-sports formats;
- tournament series/season views;
- multiple simultaneous events;
- richer broadcast packages and overlays.

These are not current commitments. They should be prioritized by actual tournament use rather than feature completeness.

---

## Milestone discipline

A milestone is complete only when:

1. its acceptance criteria are demonstrably satisfied;
2. relevant tests pass;
3. `npm run build` passes where applicable;
4. documentation reflects the implemented state;
5. unresolved limitations are recorded explicitly.
