# RACK HUB Architecture

## Status legend

- **CURRENT** — implemented now.
- **TARGET** — agreed architecture for an upcoming milestone.
- **FUTURE** — possible later extension.

## CURRENT — Legacy baseline

The inherited BBS application is a self-contained React frontend. The whitepaper describes browser-local tournament state, `localStorage` crash recovery, and browser file APIs, with no backend required for the alpha workflow.

The legacy application is valuable as a working reference, but this architecture cannot provide the shared authoritative state required for public live pages, multiple views, centralized history, or production multi-device operation.

During M0, the primary goal is only to make this application run in a conventional project. A large React component is temporarily acceptable.

## CURRENT — M2 domain extraction progress

`src/PoolTournamentApp.jsx` is still the running orchestration and state owner: it holds every `useState`, drives `recalc()`, pairing, persistence, and rendering. That has not changed.

What has changed during M2 so far:

- stable fixed-rack calculations (`src/domain/fixedRackBbs.js`) and experimental GBR_14.1 calculations (`src/domain/straightPool14_1.js`) are pure, tested, explicit-parameter modules the component calls into, rather than a second in-component implementation;
- before-round pairing reconstruction (`src/domain/beforeRoundStandings.js`) is a pure, tested function the component wraps, rather than inline component logic;
- a canonical, serializable tournament-state model now exists (`src/domain/tournamentModel.js`) documenting the `Tournament`/`Player`/`Match`/`Config` shapes the current application actually uses, plus a separate operational/session-state shape (`ApplicationState`/`PreAdvanceSnapshot`) for the current emergency-undo feature.

The canonical model is **not yet wired into the component**. `PoolTournamentApp.jsx` still owns its own `useState`-based state exactly as before; the model exists alongside it as a defined target shape, not a replacement. Converting the component's state to this model, introducing an application/store layer, and standing up a backend are later M2 tasks.

**`config` and `tournamentConfig` are separate today and can genuinely diverge — this is preserved, not consolidated, in the model.** `config` is the *active* calculation configuration recalc()/pairing/the domain match-outcome functions read, and it is live-editable at any time, including mid-tournament via the "Tournament Settings" modal. `tournamentConfig` is a separate `{title, ...settings}` snapshot captured at setup time; only its `title` is independently editable afterward (via the "edit title" flow), while its settings fields are never updated again once a tournament starts — so after a mid-tournament settings change, `tournamentConfig`'s settings values and `config`'s current values legitimately disagree, and the "Tournament Overview"/results-header display panels (which read `tournamentConfig`) can show stale values relative to what recalc() is actually using. Both are independently persisted in and restored from the localStorage autosave snapshot today. `src/domain/tournamentModel.js`'s `Tournament` shape represents both fields, unmerged, for legacy parity. A later, deliberate consolidation of this duplication is a possible **TARGET** direction once the application/store layer exists — it has **not** happened yet, and this module does not assume it.

`preAdvanceSnapshot` (the emergency "undo round advance" buffer nextRound() saves and confirmUndoAdvance() restores) is likewise separate persisted state — currently autosaved alongside the tournament, but not itself tournament truth. The model represents it as its own `PreAdvanceSnapshot` shape, wrapped together with `Tournament` in a small `ApplicationState` shape, distinct from both `Tournament` state (authoritative truth) and UI state (dialogs/tabs/forms, never persisted here).

A legacy-to-canonical application boundary now exists: `src/application/legacyStateAdapter.js`'s `captureApplicationStateFromLegacy()` maps the component's actual current state values (`config`, `tournamentConfig`, `tournament`, `players`, `pendingPlayers`, `allRounds`, `currentRound`, `preAdvanceSnapshot`) into a canonical `ApplicationState`, one direction only. It is a pure mapping — it does not normalize, default, or unify anything the legacy state doesn't already contain (an absent match `format`, either legacy bye encoding, and a transient/not-yet-recalculated player shape all pass through unchanged), and it returns a JSON-safe deep clone with no shared references back to the caller's state. **`PoolTournamentApp.jsx` does not call this adapter yet** — it exists as a boundary the component can be wired through later, not a replacement for its current state ownership. There is intentionally no reverse (canonical → legacy) mapping yet.

The legacy application has three distinct current lifecycle states, and `tournament === null` alone does **not** mean "nothing to map" — the adapter distinguishes all three (derived from existing `tournament`/`tournamentConfig` nullity; not a new persisted `status` field):
- **EMPTY** — `tournamentConfig === null` (the app has just loaded, nothing configured yet) → canonical `tournament: null`.
- **CONFIGURED_PRE_START** — `tournamentConfig !== null` but `tournament === null` (an event has been set up and players may already be registered, but "Start Tournament" hasn't been clicked) → a real canonical `Tournament` representing the configured event, with `players: []` (nobody has joined as an accumulating participant yet — that would fabricate state), `roster`/`pendingPlayers` preserved from the actual registered players, and `totalRounds` read from `config.default_rounds` (the same field `startTournament()` itself reads once it runs).
- **RUNNING** — `tournament !== null` → the existing mapping, unchanged.

An in-memory application store now exists: `src/application/tournamentStore.js`'s `createTournamentStore(initialApplicationState)` is the first thing that *owns* a canonical `ApplicationState` value independently — a small plain-JavaScript factory (`getState()`/`replaceState()`/`updateState()`), not a framework. Every read and write clones through JSON, so the store, its callers, and any prior/future reference to the same data can never alias each other's mutations. It validates via the existing `validateApplicationState()` (no duplicated validation) and rejects invalid input without disturbing its current valid state. It also exposes one read-only query, `getStandingsBeforeRound(roundLimit)`, that delegates entirely to `reconstructStandingsBeforeRound()` — demonstrating the store using the domain layer without putting any calculation back in application code. It deliberately implements **no tournament-lifecycle commands yet** (no `startTournament`/`nextRound`/`completeMatch`/undo/pairing) — those remain future, one-at-a-time migrations. **The running React app is still NOT wired through this store** — `PoolTournamentApp.jsx` continues to own the real application's state exactly as before; the store exists as the ownership boundary a future backend can wrap.

## TARGET — Three architectural concerns

RACK HUB separates three concerns:

```text
+--------------------+
| FRONTEND           |
| admin / live / OBS |
+---------+----------+
          |
          | API / service contract
          v
+--------------------+
| BACKEND            |
| authoritative state|
| persistence        |
| publication        |
+---------+----------+
          |
          | invokes domain logic
          v
+--------------------+
| DOMAIN / BBS ENGINE|
| ratings            |
| performance        |
| standings          |
| pairings / byes    |
| stage progression  |
+--------------------+
```

The domain layer is not a "backend" simply because it contains calculations. It is shared business logic and should be usable without HTTP, React, or browser APIs.

## Domain / engine boundary

### Responsibilities

The engine owns deterministic tournament logic, including as applicable:

- BBS expected score and GBR updates;
- PERF calculation;
- fixed-rack result interpretation;
- standings ordering;
- Swiss-style pairing;
- bye eligibility/selection;
- tournament/stage progression rules;
- knockout bracket progression once implemented.

### Constraints

Domain modules must not depend on:

- React components/hooks;
- DOM APIs;
- browser localStorage;
- HTTP requests;
- OBS/browser-source concerns;
- visual formatting.

A calculation should ideally be testable as a pure function given explicit input.

## Backend boundary

### TARGET responsibilities

The backend owns authoritative tournament state and publication concerns:

- current tournament configuration;
- entrants;
- rounds/matches/results;
- active stage;
- persistence;
- API used by admin and public clients;
- later: persistent tournament/player history.

The initial local backend may be intentionally small. Architecture should favor transparency and reliability over infrastructure complexity.

`src/domain/tournamentModel.js` defines the CURRENT candidate shape for that authoritative state (`Tournament`/`Player`/`Match`/`Config`/`tournamentConfig`, plus a `schemaVersion` field and lightweight structural validation), derived from what `PoolTournamentApp.jsx` actually uses today — including its current `config`/`tournamentConfig` duplication, preserved rather than resolved (see above). `src/application/tournamentStore.js` now owns and validates this shape in memory — but only when a caller explicitly constructs one; no code path in the running application does. There is still no persistence and no API for it.

TARGET: a backend process will instantiate `createTournamentStore(...)` (or its eventual successor) as its own authoritative in-process state, add persistence and the remaining lifecycle commands behind it, and expose it over an API; the React frontend will communicate through that API rather than holding tournament truth in its own `useState`. Wiring `PoolTournamentApp.jsx` through this boundary, adding the lifecycle commands (`startTournament`/`nextRound`/`completeMatch`/undo/pairing), persistence, and the API itself all remain later M2 work — none of it exists yet.

### State rule

Once M2 is complete, browser-local React state must not be the sole authoritative record of an active tournament.

See ADR 0002.

## Frontend boundary

Frontend code is split by purpose, not by separate mathematical implementations.

Expected surfaces include:

- admin/tournament-director UI;
- spectator live pages;
- OBS/browser-source overlays;
- bracket display;
- later archive and player/rating pages.

Frontend responsibilities include:

- forms and controls;
- fast result entry;
- layout and visualization;
- displaying data returned by the backend/engine;
- user-friendly validation and error states.

The frontend must not contain a second authoritative implementation of GBR/PERF/pairing logic.

## TARGET — Live data flow

```text
Admin UI
   |
   | result/state update
   v
Backend authoritative state
   |          |             |
   v          v             v
/live    /overlay/...   bracket/public views
```

Polling is acceptable for the first live skeleton. WebSockets or other push technology should only be introduced when a measured need justifies them.

## TARGET — Repository direction

Exact folders may evolve during M0–M2, but the intended separation is similar to:

```text
src/
  engine/          # pure domain/BBS logic
  frontend/        # React application and pages
  services/        # client-side API/service adapters
server/            # backend/API implementation
tests/             # unit/integration/reference fixtures
docs/              # project documentation
legacy/            # immutable historical implementation
```

Do not reorganize solely to match this diagram. Each extraction should be backed by tests and performed incrementally.

## FUTURE — Persistent platform

The platform phase will require durable records for tournaments, players, ratings, and rating history. The final persistence technology is deliberately not locked in during M0.

The API/domain boundaries should make it possible to replace a local development store with production persistence without rewriting tournament logic or presentation components.

## Architectural invariants

1. BBS logic remains explainable and regression-tested.
2. Authoritative tournament state has one owner.
3. Public and broadcast pages consume the same state as admin.
4. Event presets configure reusable formats rather than fork the product.
5. Deployment choices must not leak deeply into domain code.
6. Documentation must distinguish implemented state from planned state.
