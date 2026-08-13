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

A legacy-to-canonical application boundary now exists: `src/application/legacyStateAdapter.js`'s `captureApplicationStateFromLegacy()` maps the component's actual current state values (`config`, `tournamentConfig`, `tournament`, `players`, `pendingPlayers`, `allRounds`, `currentRound`, `preAdvanceSnapshot`) into a canonical `ApplicationState`, one direction only. It is a pure mapping — it does not normalize, default, or unify anything the legacy state doesn't already contain (an absent match `format`, either legacy bye encoding, and a transient/not-yet-recalculated player shape all pass through unchanged), and it returns a JSON-safe deep clone with no shared references back to the caller's state. **`PoolTournamentApp.jsx` does not call this adapter yet** — it exists as a boundary the component can be wired through later, not a replacement for its current state ownership.

The same module now also exposes the reverse mapping (M2K-B): `projectApplicationStateToLegacy(applicationState)` — canonical `ApplicationState` → the same eight legacy-shaped fields (`config`, `tournamentConfig`, `tournament`, `players`, `pendingPlayers`, `allRounds`, `currentRound`, `preAdvanceSnapshot`), validated via the existing `validateApplicationState()` and returned as a detached JSON-safe clone. It reads `Tournament.started` (M2K-A) directly to choose the legacy shape rather than re-deriving EMPTY/CONFIGURED_PRE_START/RUNNING heuristically: `started: false` projects to legacy `tournament: null` (config/tournamentConfig/roster/pendingPlayers/rounds/currentRound preserved as-is, nothing regenerated from defaults), `started: true` projects to a real `{ players, totalRounds }` legacy tournament object (never carrying `started` itself — legacy represents the running/not-running fact purely through `tournament` nullity), and canonical `tournament: null` (EMPTY) projects to the actual EMPTY legacy shape. Round/match data is mapped, never normalized — no `createMatch()` reconstruction. `PoolTournamentApp.jsx` is still not wired to either direction of this boundary.

**CURRENT LEGACY COMPATIBILITY — the `totalRounds` representability rule (M2K-B):**

Before start: legacy `tournament` is `null`, and `config.default_rounds` is the round-count value the real `startTournament()` will consume when Round 1 eventually starts — there is no legacy field to hold a `totalRounds` value independently before that point. A canonical `CONFIGURED_PRE_START` Tournament captured from real legacy state always has `totalRounds === config.default_rounds` (`captureApplicationStateFromLegacy()` sets it from exactly that field), so this is losslessly representable for every state this boundary is actually meant to round-trip. Because M2K-A separately allows editing canonical `tournament.config` (including `default_rounds`) while `started` stays `false`, it is *possible* to construct an artificial canonical Tournament where `totalRounds` and `config.default_rounds` disagree — `projectApplicationStateToLegacy()` cannot represent that divergence (there is no legacy field for it), so rather than silently losing one value, rewriting either one, or inventing storage, it **throws a clear compatibility error** and leaves the canonical input unchanged. This is a representability constraint of the current legacy compatibility boundary, not a defect.

Running: legacy `tournament.totalRounds` exists independently once a tournament is running, so `config.default_rounds` and `tournament.totalRounds` may legitimately diverge and are preserved separately — projection never synchronizes them, and no representability check applies to `started: true`.

**Current legacy compatibility behavior described above is not automatically the final future RACK HUB model.** The `totalRounds`/`config.default_rounds` representability rule exists to keep the *current* legacy-compatibility boundary honest; it is a statement about what today's legacy state can represent, not a design decision about how the future system should model tournament length.

The legacy application has three distinct current lifecycle states, and `tournament === null` alone does **not** mean "nothing to map" — the adapter distinguishes all three (derived from existing `tournament`/`tournamentConfig` nullity; not a new persisted `status` field):
- **EMPTY** — `tournamentConfig === null` (the app has just loaded, nothing configured yet) → canonical `tournament: null`.
- **CONFIGURED_PRE_START** — `tournamentConfig !== null` but `tournament === null` (an event has been set up and players may already be registered, but "Start Tournament" hasn't been clicked) → a real canonical `Tournament` representing the configured event, with `players: []` (nobody has joined as an accumulating participant yet — that would fabricate state), `roster`/`pendingPlayers` preserved from the actual registered players, and `totalRounds` read from `config.default_rounds` (the same field `startTournament()` itself reads once it runs).
- **RUNNING** — `tournament !== null` → the existing mapping, unchanged.

An in-memory application store now exists: `src/application/tournamentStore.js`'s `createTournamentStore(initialApplicationState)` is the first thing that *owns* a canonical `ApplicationState` value independently — a small plain-JavaScript factory (`getState()`/`replaceState()`/`updateState()`), not a framework. Every read and write clones through JSON, so the store, its callers, and any prior/future reference to the same data can never alias each other's mutations. It validates via the existing `validateApplicationState()` (no duplicated validation) and rejects invalid input without disturbing its current valid state. It also exposes one read-only query, `getStandingsBeforeRound(roundLimit)`, that delegates entirely to `reconstructStandingsBeforeRound()` — demonstrating the store using the domain layer without putting any calculation back in application code. It deliberately implements **only one small tournament-changing command so far** (`assignMatchTable`, see below); the rest of the tournament lifecycle (`startTournament`/`nextRound`/`completeMatch`/undo/pairing) remains future, one-at-a-time migrations. **The running React app is still NOT wired through this store** — `PoolTournamentApp.jsx` continues to own the real application's state exactly as before; the store exists as the ownership boundary a future backend can wrap.

A first small application command now exists in `src/application/tournamentCommands.js`: `assignMatchTable(applicationState, { roundNumber, matchId, table })` — a pure function that changes only a single match's `tbl` field and returns a new `ApplicationState`. It was written only after inspecting the current table-assignment UI in `PoolTournamentApp.jsx`: `tbl` has no fixed type (numeric at pairing time, freely overwritten with a string once a director edits it), an empty value is currently accepted, an existing assignment can always be overwritten, a completed (`done: true`) match's table remains editable in the current UI (only `cancelled` disables the input, and that disabling is a UI attribute, not a rule enforced anywhere in state), and no current code path validates table uniqueness within a round. The command preserves all of this exactly rather than introducing new rules. `src/application/tournamentStore.js` now exposes this directly as `store.assignMatchTable({ roundNumber, matchId, table })` — a thin wrapper that commits the pure command's result through the store's existing `updateState()` boundary, with no separate validation, cloning, or command logic of its own; the store method inherits `updateState()`'s atomicity, so a throw (EMPTY application, missing round, missing match) leaves the store's state completely unchanged. This is the first proof of the intended `ApplicationState → application command → store.updateState() → validated new canonical state` shape; no other tournament-changing command exists yet.

The canonical `Tournament` shape now explicitly stores a boolean `started` field (M2K-A). `started: false` means the event is configured but Round 1 has not started; `started: true` means the tournament has started/is running. This is a lifecycle marker only — it preserves, explicitly, the same distinction the legacy application currently encodes implicitly as `tournament === null` (not started) versus `tournament !== null` (started); it is never inferred from player count, round count, `currentRound`, match existence, or `pendingPlayers`. `src/application/legacyStateAdapter.js` sets it explicitly per legacy mode: `started: false` for CONFIGURED_PRE_START, `started: true` for RUNNING (EMPTY still maps to `tournament: null`, where `started` does not apply). `validateTournamentState()` now requires a boolean `started` on every non-null Tournament. `src/application/tournamentStore.js` required no code changes — `started` is preserved automatically through its existing generic `getState()`/`replaceState()`/`updateState()` cloning and validation, and is unaffected by `assignMatchTable()`. Critically, `started` does not gate or reset any other pre-start state: while `started === false`, config, `tournamentConfig`, roster, and `pendingPlayers` all remain independently editable/preservable through `updateState()` exactly as before — nothing is reconstructed from defaults merely because `started` is false. React remains unwired; `PoolTournamentApp.jsx` is untouched.

## FUTURE — director workflow and round lifecycle (explicitly NOT IMPLEMENTED)

None of the following is designed, modeled, or implemented anywhere in the codebase yet. It is recorded here, as agreed product direction from the tournament director, so future M2 work builds toward it deliberately instead of by accident, and so the CURRENT legacy-compatibility rules above (`totalRounds` representability in particular) are not mistaken for decisions about this future system. Nothing below authorizes any code change; it is documentation only.

1. **Tournament starts from a plan/preset.** A future tournament is normally created from a tournament mode/preset that establishes the planned structure — planned round count, rack count/target, relevant BBS format settings, ranking/pairing mode, and other normal format defaults. The director should rarely need to edit the preset itself. The plan is not immutable once the tournament is running (see 4 and 5 below).

2. **Per-round director review (Round Setup / Preview).** Before a round becomes official there should eventually be an intermediate director review stage, where the director can: inspect generated pairings; move pairings between tables; swap table assignments; add newly joining players; withdraw players from future pairing while preserving their history; manually correct problematic pairings as an emergency tool; adjust that round's effective settings; and update available tables if capacity changes. Round 1 uses the same conceptual workflow as later rounds, even though some of these options are less likely to be exercised there. Not implemented; no such screen or state exists.

3. **Confirmation is the official/publication boundary.** A prepared/generated round is not yet official or public. Only after the director confirms/starts a round should it become an official tournament round, visible on the tournament dashboard, and eventually available to public/livescore consumers. This is a future architecture requirement, not current behavior — no publication or live-view behavior exists yet.

4. **Round-specific settings are historically locked once confirmed.** Future RACK HUB must allow format adjustments during an event (for example: a tournament planned for 5 rounds × 8 racks, played at 8 racks through Round 3, then changed to 6 racks from Round 4 onward to save time) without rewriting the effective settings a previously confirmed round was actually played under. Confirmed rounds therefore eventually need their effective settings preserved as historical facts (a per-round settings snapshot). Not implemented — no such snapshot exists; today's `config` is a single live, mutable value with no per-round history.

5. **An event may be shortened.** The director must eventually be able to conclude a tournament/phase earlier than originally planned — for example, planned for 5 rounds but deciding after Round 4 that Round 4 is final because of the schedule — via an explicit future action conceptually like "Finish tournament/phase with this round." Today's `totalRounds`/`config.default_rounds` behavior (a single planned round count, read once at start) should not be assumed to be the final RACK HUB design for this.

6. **Recalculation is not re-pairing.** This is a hard future product rule. If a historical match result is corrected later, RACK HUB should recalculate derived numerical truth — match/tournament score, MP, rack differential/point-difference metrics, GBR, PERF, standings, other cumulative calculated values, and final/exported values — but must **not** automatically regenerate already-confirmed pairings. Confirmed historical decisions remain structurally locked unless the director explicitly chooses otherwise (see 7). Not implemented — no result-correction or recalculation-trigger workflow exists in the canonical/application layers yet.

7. **Pairings change only through an explicit future "Rebuild Round X."** Regenerating pairings for an already-confirmed round is exceptional and deliberate, never an automatic side effect of a score correction. A future rebuild should eventually reconstruct the appropriate pre-round calculation state and let the director review the regenerated round before confirming it. Not implemented — no such command exists, and none is planned for the remainder of M2.

8. **Tables are future event state.** The future system should support a tournament table list that can change during the event; table order may represent preference/quality so stronger pairings can be placed on preferred tables, and the director should be able to add capacity (more tables) for future rounds if more players join. Confirmed historical table assignments remain unchanged when the table list changes later. Not implemented — today's table handling is limited to `assignMatchTable()`'s single-match `tbl` edit (see M2J above); there is no table-list/capacity model.

9. **Player join/withdraw semantics.** A joining player is added between rounds and incorporated into future pairing per the established BBS logic, with GBR positioned appropriately relative to the current PERF/field state. A withdrawing player is removed from future pairing availability while all previously played matches/history remain intact. Not implemented as a lifecycle command — today's `pendingPlayers`/`roster`/`removed` fields exist in the canonical model (see M2G) purely as legacy-compatible data shapes, not as a designed join/withdraw workflow.

10. **Result entry/correction direction.** Future fixed-rack result entry should support fast score entry, including increment/decrement controls and an optional autocomplete workflow where mathematically safe/applicable (autocomplete is not intended for 14.1). Completed results must remain correctable later; corrections recalculate numerical metrics (per rule 6) without automatically changing confirmed pairings. Not implemented — no result-entry or result-correction UI or command exists yet.

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

TARGET: a future application command will make the explicit, controlled `started: false → true` transition (starting Round 1), analyzed against legacy `startTournament()` behavior — not implemented yet. The canonical → legacy compatibility projection itself now exists (M2K-B, see above) and already reads `Tournament.started` directly rather than re-deriving the EMPTY/CONFIGURED_PRE_START/RUNNING distinction heuristically.

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
