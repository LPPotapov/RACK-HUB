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

An in-memory application store now exists: `src/application/tournamentStore.js`'s `createTournamentStore(initialApplicationState)` is the first thing that *owns* a canonical `ApplicationState` value independently — a small plain-JavaScript factory (`getState()`/`replaceState()`/`updateState()`), not a framework. Every read and write clones through JSON, so the store, its callers, and any prior/future reference to the same data can never alias each other's mutations. It validates via the existing `validateApplicationState()` (no duplicated validation) and rejects invalid input without disturbing its current valid state. It also exposes one read-only query, `getStandingsBeforeRound(roundLimit)`, that delegates entirely to `reconstructStandingsBeforeRound()` — demonstrating the store using the domain layer without putting any calculation back in application code. It implements two tournament-changing commands so far (`assignMatchTable` and `startTournament`, see below); the rest of the tournament lifecycle (`nextRound`/`completeMatch`/undo) remains future, one-at-a-time migrations. **The running React app is still NOT wired through this store** — `PoolTournamentApp.jsx` continues to own the real application's state exactly as before; the store exists as the ownership boundary a future backend can wrap.

A first small application command now exists in `src/application/tournamentCommands.js`: `assignMatchTable(applicationState, { roundNumber, matchId, table })` — a pure function that changes only a single match's `tbl` field and returns a new `ApplicationState`. It was written only after inspecting the current table-assignment UI in `PoolTournamentApp.jsx`: `tbl` has no fixed type (numeric at pairing time, freely overwritten with a string once a director edits it), an empty value is currently accepted, an existing assignment can always be overwritten, a completed (`done: true`) match's table remains editable in the current UI (only `cancelled` disables the input, and that disabling is a UI attribute, not a rule enforced anywhere in state), and no current code path validates table uniqueness within a round. The command preserves all of this exactly rather than introducing new rules. `src/application/tournamentStore.js` now exposes this directly as `store.assignMatchTable({ roundNumber, matchId, table })` — a thin wrapper that commits the pure command's result through the store's existing `updateState()` boundary, with no separate validation, cloning, or command logic of its own; the store method inherits `updateState()`'s atomicity, so a throw (EMPTY application, missing round, missing match) leaves the store's state completely unchanged. This is the first proof of the intended `ApplicationState → application command → store.updateState() → validated new canonical state` shape; no other tournament-changing command exists yet.

The canonical `Tournament` shape now explicitly stores a boolean `started` field (M2K-A). `started: false` means the event is configured but Round 1 has not started; `started: true` means the tournament has started/is running. This is a lifecycle marker only — it preserves, explicitly, the same distinction the legacy application currently encodes implicitly as `tournament === null` (not started) versus `tournament !== null` (started); it is never inferred from player count, round count, `currentRound`, match existence, or `pendingPlayers`. `src/application/legacyStateAdapter.js` sets it explicitly per legacy mode: `started: false` for CONFIGURED_PRE_START, `started: true` for RUNNING (EMPTY still maps to `tournament: null`, where `started` does not apply). `validateTournamentState()` now requires a boolean `started` on every non-null Tournament. `src/application/tournamentStore.js` required no code changes — `started` is preserved automatically through its existing generic `getState()`/`replaceState()`/`updateState()` cloning and validation, and is unaffected by `assignMatchTable()`. Critically, `started` does not gate or reset any other pre-start state: while `started === false`, config, `tournamentConfig`, roster, and `pendingPlayers` all remain independently editable/preservable through `updateState()` exactly as before — nothing is reconstructed from defaults merely because `started` is false. React remains unwired; `PoolTournamentApp.jsx` is untouched.

A canonical application-layer equivalent of current legacy `startTournament()` now exists (M2L): `src/application/tournamentCommands.js`'s `startTournament(applicationState, { seedMethod, manualSeeding, tableNumbers })` reproduces the current legacy transition exactly, verified by direct inspection of `PoolTournamentApp.jsx`'s `startTournament()`/`createPairings()` before writing it (see that command's own extensive header comment for the full characterization). It requires `tournament.started === false` and, on success, transitions `started: false → true` explicitly (never inferred from player/round counts, matching M2K-A). `totalRounds` is captured from `tournament.config.default_rounds` at the moment of start, matching current legacy behavior exactly — this states nothing about the FUTURE event-length/shortening model (see below). `tournament.players` is built from `tournament.roster` in the same minimal transient shape current `startTournament()` itself writes (`mp`/`perf`/`games`/`opps`/`removed`/`joinedRound` only — no `perfCount`/`racksWon`/`rp`/14.1 aggregates yet); the real app's `recalc()` effect normalizes this further immediately afterward, but `recalc()` is a separate, general-purpose, not-yet-extracted mechanism this command does not reproduce (recommended for a future milestone — see docs/TESTING.md). `pendingPlayers` is left completely untouched, including any pre-start registration duplicated into both the roster and `pendingPlayers` by `addPlayerToTournament()` — current code never clears it at start. `config`/`tournamentConfig`/`preAdvanceSnapshot` are all untouched.

Round 1 generation is delegated to a new pure domain module, `src/domain/pairing.js`'s `generatePairings()` — a faithful, unmodified extraction of `createPairings()` (moved here, not redesigned, because AGENTS.md places "Swiss-style pairing; bye eligibility/selection" in the domain/engine layer, and the application command needs it without depending on React). It reproduces bye assignment (whitepaper §9.2), the Round-1-only direct-pairing seed methods (`random`/`cross_elo`/`manual`), the Swiss/cost-based pairing used for every other round and for `'elo'`/unrecognized Round-1 seeding, table numbering (`tableNumbers[...] || sequential fallback`), and 14.1 tier-target stamping — with no BBS formula changes. `seedMethod`/`manualSeeding`/`tableNumbers` are explicit command arguments, not new canonical fields — they were already documented as UI-only, one-time round-setup inputs with no canonical home (see the Tournament model notes above); `seedMethod` has no default (an omitted value would silently pick a specific current pairing strategy on the caller's behalf), matching the `started` field's own established precedent.

`src/application/tournamentStore.js` exposes this as `store.startTournament(args)`, following the exact same thin-wrapper-over-`updateState()` pattern as `assignMatchTable`, with the same atomicity guarantee (a throw leaves the store's prior valid state completely unchanged).

**Discovered legacy quirk, characterized not reproduced:** current legacy `startTournament()` calls `setTournament(...)` unconditionally *before* checking whether `createPairings()` found a legal bye — if it later returns `null`, legacy is left in a broken state (`tournament !== null` but `allRounds`/`currentRound` never updated). No-legal-bye failure is unreachable through normal current UI-created pre-start state — a director-driven CONFIGURED_PRE_START capture always has empty bye history and no new-player protection for a fresh Round 1, so a bye candidate always exists for any non-empty roster. It is not unreachable for every structurally valid canonical pre-start state, though: M2K-A's pre-start editability permits constructing an artificial canonical Tournament whose round history marks every player bye-ineligible (see `tests/tournament-commands.test.js`'s dedicated artificial-prior-bye test). For that input, the canonical command rejects atomically before committing any change, rather than reproducing legacy's theoretical partial-commit ordering bug — this is not a claim that the two behaviors are equivalent for an unreachable edge case, only that this command fails safely where legacy's own ordering would not.

Full-history tournament recalculation has now been extracted into a pure domain module (M2M-A): `src/domain/tournamentRecalculation.js`'s `recalculateTournamentPlayers({ players, roster, rounds, currentRound, config })` reconstructs every derived player statistic (MP, GBR, PERF, racks, RP, and the 14.1 aggregate fields) by replaying stored round history from each player's starting GBR, verified against direct inspection of `PoolTournamentApp.jsx`'s `recalc()` — not assumed from prior comments (see that module's own extensive header for the full characterization). **Stored rounds/pairings are a read-only input.** This function has no way to add, remove, or reorder a match, player snapshot, table assignment, or historical target — it only computes new derived numbers for `players`, matching the hard product rule that recalculation never re-pairs. Rounds replay strictly `1..currentRound` (not every key present in `rounds`), and within a round, matches replay in stored array order — GBR evolves sequentially, never computed from final/latest values in one pass. Starting GBR is read from `roster` via the exact same plain-object, string-coerced, last-write-wins lookup current `recalc()` uses (`startElos[p.id] || p.elo`) — deliberately NOT replaced with a `.find()`/Map lookup, since that would change observable behavior for duplicate/mixed-type roster ids. The fixed-rack path reuses `applyFixedRackMatch()` (the same function `recalc()` itself already calls); the 14.1 path reuses `straightPoolMatchOutcome()`, with RP/opponent-history/14.1-aggregate accrual implemented in the new module (mirroring `recalc()`'s own inline accrual, since `straightPoolMatchOutcome()` deliberately excludes those). For a 14.1 match, a truthy stored `match.target` is used; a falsy/missing `target` falls back to the current active `config.straightPool.startTarget` — the historical target is read exactly as stored, never recomputed from current tier config. React still uses its own legacy `recalc()` path and is not wired to this module yet — `PoolTournamentApp.jsx` is untouched.

**CURRENT LEGACY COMPATIBILITY — config history:** `recalc()` has no per-round historical config snapshot. Every stored round, however long ago it was played, is recalculated using whatever `config`/`config.straightPool` is CURRENTLY active — changing the active config retroactively changes the derived numbers for every already-played round, not just future ones. This is preserved exactly, not corrected. A future RACK HUB will preserve round-specific effective settings (see the FUTURE note below); that does not exist yet.

**AUTHORITATIVE BBS RULE — bye/FREILOS games accrual (director-confirmed correction, the ONE deliberate divergence from legacy `recalc()` in this module):** a bye/FREILOS is not a played match. It awards +1 MP and the normal RP compensation for participating in the round and receiving 1 MP/a win (`rp_per_round + 1 * rp_per_mp`, with NO positive-GBR-change RP component, since no GBR calculation occurs for a bye) — but it does NOT affect GBR, PERF, `perfCount`, rack/point statistics, opponent history, or **games**. The original M2M-A extraction faithfully reproduced legacy `recalc()`'s (and `fixedRackBbs.js`'s `applyFixedRackMatch()`'s) actual `games + 1` accrual for a bye; the tournament director has since clarified that this is a legacy artifact, not authoritative BBS methodology, and it has been corrected in `recalculateTournamentPlayers()` only. `fixedRackBbs.js`'s `applyFixedRackMatch()` and the live `PoolTournamentApp.jsx`/`recalc()` are untouched and still increment games for a bye — this is a genuine, intentional divergence between the canonical engine and legacy, the first one in this project, made necessary because `applyFixedRackMatch()` is shared with the still-running legacy component and must not be changed. RP accrual itself was already correct in the original extraction and required no change.

**Discrepancy between existing extracted domain helpers and legacy `recalc()`, reported not silently reconciled:** `src/domain/fixedRackBbs.js` already contains an unused `replayFixedRackHistory()`/`initialReplayPlayer()` pair (predating M2M-A, never imported by `PoolTournamentApp.jsx` or wired into `recalc()`) that looks superficially similar to this task's goal but is NOT behaviorally equivalent to current `recalc()`: it resolves starting GBR from a `player.startingGbr` field rather than a separate roster lookup, it does not initialize the 14.1 aggregate fields at all, and it replays every round key present in its `rounds` argument rather than bounding replay to `1..currentRound`. `recalculateTournamentPlayers()` therefore does NOT call `replayFixedRackHistory()` — it reuses only the lower-level `applyFixedRackMatch()` (which IS what `recalc()` itself calls) and reimplements the outer replay loop with `recalc()`'s actual semantics. `replayFixedRackHistory()`/`initialReplayPlayer()` are left untouched (M2M-A does not modify BBS formulas or existing tested modules); a future task may want to reconcile or retire them once nothing else depends on their current shape.

**Discrepancy between `recalc()` and `reconstructStandingsBeforeRound()`'s starting-GBR lookup, reported not forced together:** `reconstructStandingsBeforeRound()` (M2F) resolves starting GBR via `startingRoster.find(pl => pl.id === p.id)` — strict `===`, first-match. `recalc()` (and `recalculateTournamentPlayers()`) resolve it via a plain object keyed by id — coercing every id to a string key, last-write-wins for a colliding/duplicate id. These two already-approved legacy-derived behaviors are genuinely different for a roster containing duplicate or mixed-type ids; M2M-A does not attempt to unify them, since they serve different legacy code paths with different real behavior. Every other overlapping field the two functions compute (MP, PERF, GBR, racks/points, opponent history) has been cross-checked and is consistent for representative fixed-rack and 14.1 histories with well-formed rosters (see `tests/tournament-recalculation.test.js`); RP is the one field `reconstructStandingsBeforeRound()` deliberately never tracks (pairing input never reads it), so it is excluded from that cross-check, not reconciled. **A second, newly-introduced exception:** following the bye/FREILOS `games` correction above, `reconstructStandingsBeforeRound()` still increments `games` for a bye (unchanged — out of scope for that correction, since it exists only to prepare pairing input, and `games` feeds no current pairing/cost formula), while `recalculateTournamentPlayers()` now does not. This divergence is proven, not hidden, by a dedicated test; a future task may want to decide whether `reconstructStandingsBeforeRound()` should adopt the same corrected rule.

A canonical application command for entering and correcting a match result now exists (M2M-B): `src/application/tournamentCommands.js`'s `recordMatchResult(applicationState, { roundNumber, matchId, r1, r2, p1Points, p2Points, innings, p1HighRun, p2HighRun })`, verified against direct inspection of `PoolTournamentApp.jsx`'s `completeMatch()` (see that command's own extensive header comment for the full characterization). It requires a real RUNNING tournament (`tournament !== null`, `started === true`) and dispatches on the EXISTING match's own stored `format`, exactly like `completeMatch()` — fixed-rack and format-less matches share one validation path (auto-complete when only one side is entered, then a strict `r1 + r2 === config.max_games` check), 14.1 matches take a separate validation path (points/innings/high-run checks matching `completeMatch()`'s four guards in the same order, plus the `r1`/`r2` mirror onto `p1Points`/`p2Points` legacy keeps "for compatibility with any legacy reads"). **RECALCULATION != RE-PAIRING**: on success, it modifies ONLY the approved result fields on exactly one match (`r1`/`r2`/`done` for fixed-rack; `p1Points`/`p2Points`/`innings`/`p1HighRun`/`p2HighRun`/`r1`/`r2`/`done` for 14.1) and then calls `recalculateTournamentPlayers()` with the updated rounds — it never touches `p1`/`p2`/`tbl`/`target`/`format`/`id`/`bye`, never invokes the pairing module, and never alters any other match or round. This works identically whether the match is being entered for the first time or corrected after already being marked done — a correction to an earlier round's result recalculates every later round's derived player metrics through the same full-history replay, while every later round's *stored* pairings/tables/targets remain byte-for-byte unchanged (see `tests/historical-14-1-correction.test.js` for a cross-check against the real historical fixture). A bye match has no legacy UI path to write a result at all (no input is ever rendered for it, not merely disabled) and is rejected explicitly. A cancelled match has no `cancelled` guard in `completeMatch()` itself — matching the same "UI attribute, not a data-layer rule" pattern already established for `assignMatchTable()` — so this command doesn't guard on it either; `recalculateTournamentPlayers()` already ignores any cancelled match unconditionally, so this is harmless. Every authoritative numeric result field (`r1`/`r2`/`p1Points`/`p2Points`/`innings`/`p1HighRun`/`p2HighRun`) must be `Number.isInteger(...)`-true — no `Number(...)` coercion, no `parseInt(...)` — this is a corrected application-input contract (not a legacy behavior change; legacy's own `<input>` handlers already stage integers via `parseInt` before `completeMatch()` ever runs), preventing a caller from ever persisting a fractional score. `src/application/tournamentStore.js` exposes this as `store.recordMatchResult(args)`, the same thin-wrapper-over-`updateState()` pattern as the other two commands. React is still not wired to this command — `PoolTournamentApp.jsx` is untouched.

A canonical application command for round advancement now exists (M2N): `src/application/tournamentCommands.js`'s `advanceTournamentRound(applicationState, { tableNumbers })`, verified against direct inspection of `PoolTournamentApp.jsx`'s `nextRound()` (see that command's own extensive header comment for the full characterization). It requires a real RUNNING tournament, that every match in the current round be `done` or `cancelled`, and that `currentRound < totalRounds`. **RECALCULATION != RE-PAIRING**: this command generates ONLY `rounds[currentRound + 1]`, using `generatePairings()` (the same domain module `startTournament()` already uses) — no existing round is ever modified, added to, or removed; a dedicated test proves every prior round remains byte-for-byte unchanged after advancing, and a multi-advance test proves this holds across repeated advances (Round 1 → 2 → 3). Standings for pairing input are the tournament's current, format-aware-sorted players (`compareStraightPool()`/`compareFixedRackPairingOrder()`) — a **canonical-world necessity**: this command calls `recalculateTournamentPlayers()` itself first, since (unlike legacy's automatic `useEffect`) nothing else guarantees `tournament.players` is current before pairing, particularly for a round consisting only of byes (which `recordMatchResult()` never touches). Pending players are promoted using legacy's exact closest-avgPerf-insertion algorithm and the same minimal transient Player shape `startTournament()`-adjacent code already documents; `pendingPlayers` is cleared on success (unlike `startTournament()`, which deliberately does not clear it). A `preAdvanceSnapshot` is captured on every successful advance, in the exact established legacy shape (`{ tournament: { players, totalRounds }, allRounds, currentRound, viewingRound, pendingPlayers }`, `allRounds` never renamed) and **fully detached** (`JSON.parse(JSON.stringify(...))`, matching legacy's own snapshot-capture semantics — a Codex-reported follow-up fix) from both the command's input and its returned tournament, so mutating any one of `result.preAdvanceSnapshot`, `result.tournament`, or the original `applicationState` can never affect either of the others. `src/application/tournamentStore.js` exposes this as `store.advanceTournamentRound(args)`, the same thin-wrapper pattern as the other three commands. React is still not wired to this command.

**Discovered discrepancy against this task's own suggested hint, verified not assumed:** the task suggested reusing `reconstructStandingsBeforeRound()` for pre-pairing standings — direct source inspection shows legacy `nextRound()` does NOT call it; it uses `tournament.players` directly ("tournament.players already carries full recalc standings" — legacy's own comment). `reconstructStandingsBeforeRound()` exists for a different legacy path (regenerating the CURRENT round after a structural change in `performDeletePlayer()`/`removePlayersFromRound()`), not for generating the NEXT round. `advanceTournamentRound()` therefore does not call it either — see that command's header comment.

**Real historical 14.1 replay result (M2N):** running the actual canonical chain (`startTournament(cross_elo)` → `recordMatchResult()` for every real Round 1 result → `advanceTournamentRound()`) against the `vm-joes-14-1` fixture reproduces Round 1's pairings exactly (5/5) and its PERF values exactly for all 10 players (confirming `d: 330` and the metadata-documented 14.1 weights). Round 2 is the first divergent round: 3 of 5 player pairings match exactly; one already-correct pairing (Gäbler/Potapov) receives a different tier target (30 generated vs. 40 historical) at a knife-edge tier-size boundary (Gäbler is exactly the 5th of 10 players by standings); the remaining two matches show swapped partners between the tournament's two "Heim" players, decided by a single-point PERF-gap tie-break in the Swiss/cost-based greedy algorithm. Both divergences trace to genuine remaining config/rounding uncertainty at extremely tight numerical boundaries (metadata.json's own `knownConfigurationUncertainty`), not to a pairing or formula defect — no formula was tuned to force a match. See `tests/historical-14-1-replay.test.js`.

**A complete canonical tournament command loop now exists and is integration-tested through the full legacy compatibility boundary (M2O):** `captureApplicationStateFromLegacy() → startTournament() → recordMatchResult() → advanceTournamentRound() → (repeat) → projectApplicationStateToLegacy()` composes entirely from already-existing, already-unit-tested exports — no new production code, orchestration module, or business logic was needed or added. Two integration tests exercise this: a synthetic fixed-rack chain (configure → capture → start → score every Round 1 match → advance → score every Round 2 match → advance to Round 3 → correct an *earlier* Round 1 result after Rounds 2–3 already exist → project back to legacy) and a real historical 14.1 chain against the `vm-joes-14-1` fixture, driven as far as the already-characterized evidence allows (Round 1 exact, Round 2 mixed real/clearly-labeled-synthetic results per the M2N divergence, Round 3 for chain-mechanics only — not claimed historically accurate). Both confirm: the projected legacy shape carries `config`/`tournamentConfig`/`tournament.players`/`totalRounds`/`allRounds`/`currentRound`/`pendingPlayers`/`preAdvanceSnapshot` correctly, with no canonical-only field (`started`, `roster` as a nested key, etc.) leaking into the legacy `tournament` object; string table identifiers, 14.1 targets, and a mid-tournament pending-player promotion all survive the full round trip; prior rounds remain byte-for-byte locked through a later correction, both canonically and in the projected legacy shape; and re-capturing the projected legacy state reproduces the same canonical meaning. React still reads/writes its own legacy state directly and has **not** been rewired to any of this — that remains a distinct, later task; this milestone proves the application-layer chain works, not that the frontend or a backend uses it yet.

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

10. **Result entry/correction direction.** Future fixed-rack result entry should support fast score entry, including increment/decrement controls and an optional autocomplete workflow where mathematically safe/applicable (autocomplete is not intended for 14.1). Completed results must remain correctable later; corrections recalculate numerical metrics (per rule 6) without automatically changing confirmed pairings. A canonical `recordMatchResult` application command exists as of M2M-B (see above) reproducing CURRENT legacy `completeMatch()` result semantics exactly, including its existing single-missing-side auto-complete — but no result-entry UI exists, and none of the future conveniences described here (+1/-1 controls, a friendlier autocomplete workflow) are implemented.

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
