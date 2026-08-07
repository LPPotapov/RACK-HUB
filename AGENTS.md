# RACK HUB Development Rules

These rules apply to human developers and coding agents.

## 1. Product boundary

RACK HUB is tournament-management and live-publishing software.

The Batforce Billiards System (BBS) is a tournament and rating methodology implemented by RACK HUB. Do not use the names interchangeably.

## 2. Read before changing architecture

Before architecture, state-model, API, tournament-format, or deployment work, read:

- `README.md`
- `docs/VISION.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- relevant files under `docs/decisions/`

For any BBS behavior change, also read:

- `docs/BBS.md`
- the BBS whitepaper in the repository
- the legacy reference implementation

## 3. Sources of truth

For stable fixed-rack BBS behavior:

1. the BBS whitepaper is the normative specification;
2. the legacy application is the reference implementation;
3. regression tests preserve verified behavior during refactoring.

If the whitepaper and legacy behavior appear to disagree, **do not silently choose one**. Document the discrepancy and stop or ask for an explicit decision.

The legacy source and whitepaper are reference artifacts. Do not modify them as part of normal implementation work.

## 4. BBS protection rules

Do not change any of the following unless the task explicitly requests a behavioral change:

- GBR mathematics;
- PERF mathematics;
- fixed-rack match-point behavior;
- pairing order or pairing costs;
- bye selection or bye scoring;
- standings order or tie-break rules;
- recalculation semantics.

Experimental 14.1 behavior must remain isolated from stable fixed-rack BBS behavior.

Do not silently "improve", simplify, normalize, or reinterpret existing formulas.

## 5. Architecture rules

The long-term architecture has three distinct concerns:

- **domain/engine** — deterministic tournament and BBS logic;
- **backend** — authoritative tournament state, persistence, and publication API;
- **frontend** — admin controls, public pages, and broadcast/OBS views.

Domain calculations must not depend on React, browser UI state, HTTP, or OBS.

React components must not become the authoritative home of tournament mathematics.

Public/live views must eventually consume the same backend state as the admin UI.

Tournament-specific behavior should be modeled through reusable formats/stages/presets rather than scattered event-name checks.

## 6. Scope discipline

Prefer small, reviewable changes over broad rewrites.

- Do not modify unrelated files.
- Do not rename or reorganize large areas unless the task requires it.
- Do not add infrastructure because it may be useful later.
- Do not add dependencies without a concrete need.
- Do not begin the next milestone automatically after finishing the current task.

## 7. Testing and build discipline

When tests exist, run the relevant tests before completing work.

Before completing a code task, run:

```bash
npm test
npm run build
```

If a command is not yet available, report that explicitly rather than pretending it passed.

Any extraction or refactor of BBS logic must preserve the M1 reference-tournament baseline and relevant unit tests.

## 8. Documentation is part of the implementation

The repository must remain understandable to a developer who has never worked on RACK HUB before.

When a task changes any of the following, update the relevant documentation in the same task:

- architecture or project structure;
- commands or developer setup;
- API contracts;
- tournament formats;
- persistence or deployment behavior;
- milestone status;
- accepted design decisions.

Use the status terms consistently:

- **CURRENT** — implemented and verified;
- **TARGET** — agreed architecture or behavior not yet complete;
- **FUTURE** — possible later work.

Do not mark a milestone complete until its acceptance criteria pass and the documentation reflects the resulting system.

## 9. Git and agent workflow

`main` should remain working.

Use focused branches for significant tasks. One coding agent should implement a change at a time on a branch. A second agent may review high-risk changes after the implementation is complete.

Do not commit or push unless explicitly requested by the project owner.

Do not delete historical fixtures, legacy references, or architecture-decision records without an explicit task.

## 10. Completion report

At the end of a task, report concisely:

1. files added;
2. files changed;
3. dependencies added or removed;
4. tests/build commands run and their result;
5. assumptions or unresolved issues;
6. documentation updated.
