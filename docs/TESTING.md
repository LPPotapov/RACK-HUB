# RACK HUB Testing Strategy

## Purpose

The highest-risk failure in RACK HUB is not a visual bug. It is silently changing tournament outcomes while restructuring the legacy application.

Testing therefore begins with behavioral reproduction before large refactoring.

## CURRENT — Normalized historical evidence

The original historical CSV exports remain unchanged under `legacy/`. Normalized,
machine-readable copies are stored under `tests/fixtures/historical/`, separated by
tournament. Data-integrity tests verify that normalization preserves basic exported
invariants and representative source values.

These fixtures are compatibility/reference evidence, not engine golden masters. The
14.1 data comes from an experimental legacy implementation, while the surviving
9-ball and 10-ball exports contain final tables only. A full historical
engine-replay golden master was not required to close M1; see "Reference
tournament / golden master" below.

## CURRENT — Stable fixed-rack safety net

Focused tests now exercise the stable fixed-rack expected-score, GBR, PERF, match-point,
standings, standard-pairing, bye, and history-recalculation behavior through a small
shared pure-function seam. A synthetic replay fixture verifies starting-GBR reset,
stored processing order, downstream recalculation, ignored cancelled/incomplete
matches, and idempotence. Experimental 14.1 logic is excluded.

Classic standings are tested against the whitepaper-defined `MP -> PERF -> ID` rule:
match points strictly dominate PERF (an extreme PERF gap can never outweigh 1 MP),
ties are resolved by average PERF, and remaining ties fall back to deterministic
player ID. Rack Differential standings are unchanged (`MP -> Rack Differential ->
PERF -> ID`).

Together with the normalized historical fixtures above, this is the M1 baseline
regression suite.

## CURRENT — Experimental 14.1 characterization

The GBR_14.1 experimental straight-pool calculation cluster (signal construction,
14.1 PERF, 14.1 GBR change, point-differential normalization, race-target tiering,
and 14.1 standings order) has direct unit characterization tests and a pure module
seam, mirroring the stable fixed-rack safety net above. These tests characterize
current behavior — including existing fallback/default quirks such as the
floating-point difference between "weights omitted" and "explicit default weights"
in weight normalization — rather than asserting a preferred/corrected formula.
Experimental 14.1 logic remains isolated from stable fixed-rack behavior and is not
part of the M1 baseline.

Both `src/domain/fixedRackBbs.js` (`fixedRackMatchOutcome`) and
`src/domain/straightPool14_1.js` (`straightPoolMatchOutcome`) now expose a single
pure "given two pre-match GBR values and one completed match, what is the
numerical outcome" primitive per format. `PoolTournamentApp.jsx`'s `recalc()` and
`buildStandingsBeforeRound()` both call these instead of independently
recalculating signals/PERF/GBR-change/NPD/GD inline; each function's own
orchestration (player lookup vs. dict-based standings reconstruction, the
absent-historical-opponent snapshot-GBR fallback, RP accrual, opponent-history
bookkeeping) is untouched and stays outside the domain layer.

The former `buildStandingsBeforeRound()` reconstruction algorithm — used to
prepare pairing input for a not-yet-generated round — is now
`reconstructStandingsBeforeRound()` in `src/domain/beforeRoundStandings.js`,
an exported pure function taking the tournament roster, a separate
starting-GBR source roster, round history, and config explicitly. Direct tests
cover: multi-round replay order, the snapshot-GBR fallback for a
withdrawn/removed historical opponent (for both fixed-rack and 14.1),
`joinedRound` eligibility, cancelled/incomplete-match exclusion, both legacy
bye encodings, fixed-rack/14.1 format isolation, the absence of RP/Prestige
tracking, starting-GBR source precedence over a player's own stale `elo`
field, and that a player's second match in the same replay uses the GBR their
first match produced (not a re-read of the starting source). `PoolTournamentApp.jsx`
now retains only a thin wrapper that resolves its own component state into
these explicit inputs.

## CURRENT — Canonical tournament-state model (M2G)

`src/domain/tournamentModel.js` defines and documents the `Tournament`/
`Player`/`Match`/`Config` shapes the current application actually uses,
including legacy compatibility details: two bye encodings; `removed`/
`joinedRound` fallback semantics; the separate roster used only for
starting-GBR resolution; always-present 14.1 aggregate fields; `format` being
genuinely optional on a Match (the Manual Pairing Editor's stored matches
omit it entirely — `createMatch()` does not default it); and the confirmed,
preserved divergence between `config` (live, active calculation settings)
and `tournamentConfig` (a separate setup/display snapshot, independently
editable via the title-edit flow, not updated by mid-tournament settings
changes) — both fields are represented, unmerged. A separate
`ApplicationState`/`PreAdvanceSnapshot` shape represents the current
emergency-undo feature's persisted data, distinct from `Tournament` truth and
from UI state. It is additive only — `PoolTournamentApp.jsx` does not
construct or consume this model yet.

`tests/tournament-model.test.js` covers: representing a minimal fixed-rack
event and a 14.1 event, a JSON round-trip preserving meaning, legacy-optional
fields surviving construction (including an absent `format`), player ids
never being type-coerced, match snapshot/target/table/done/cancelled/bye
representability (under both legacy bye encodings), `removed`/`joinedRound`
representability, the absence of functions/class instances/Map/Set/Date
anywhere in the model, `validateTournamentState()` accepting quirky-but-legal
legacy shapes while rejecting only structurally malformed input, `config`/
`tournamentConfig` divergence surviving JSON serialization, a partial
`straightPool` config override merging onto defaults rather than replacing
them, a production-style Manual Pairing Editor match and a production-style
`createPairings()` match, a configured-but-not-yet-started (pre-Round-1)
tournament, a mid-`nextRound()` promoted player's transient shape, and
`PreAdvanceSnapshot`/`ApplicationState` round-tripping through JSON without
losing undo-required data.

## CURRENT — Legacy-to-canonical application boundary (M2H)

`src/application/legacyStateAdapter.js`'s `captureApplicationStateFromLegacy()`
maps the component's actual current state values into the canonical
`ApplicationState`, one direction only (legacy → canonical; no reverse
mapping yet). It is a pure mapping, not a cleanup pass — it does not add a
`format` to a format-less match, does not fill in a transient player's
missing aggregate fields, and does not unify the two legacy bye encodings.
`PoolTournamentApp.jsx` does not call it yet.

The adapter distinguishes three current legacy lifecycle states rather than
treating `tournament === null` as always meaning "nothing to map": **EMPTY**
(`tournamentConfig === null`, canonical `tournament: null`),
**CONFIGURED_PRE_START** (`tournamentConfig` set but `tournament` still null —
an event configured, players possibly already registered, before "Start
Tournament" — canonical `tournament` is non-null, with `players: []`,
`roster`/`pendingPlayers` preserved, and `totalRounds` read from
`config.default_rounds`), and **RUNNING** (`tournament !== null`, mapped from
its own `players`/`totalRounds`, unchanged from the original M2H mapping).

`tests/legacy-state-adapter.test.js` covers: a normal fixed-rack running
tournament and a 14.1 running tournament mapping correctly, `config`/
`tournamentConfig` staying independent through the mapping, the global roster
and `tournament.players` staying independent (a pending, not-yet-promoted
player), pending players surviving unchanged, `allRounds` becoming canonical
`Tournament.rounds`, `preAdvanceSnapshot` keeping its actual `allRounds` field
name (never renamed to `rounds`), a format-less Manual Pairing Editor match
surviving unchanged, both legacy bye encodings surviving unmerged, a
transient mid-`nextRound()` player shape surviving without added fields, the
captured snapshot sharing no mutable references with the legacy inputs
(verified by mutating the originals after capture and asserting no effect),
the produced state always passing `validateApplicationState()`, the adapter
throwing a clear error for structurally invalid legacy input, and an explicit
state-mode matrix (EMPTY, CONFIGURED_PRE_START, RUNNING, RUNNING with a
preAdvanceSnapshot, RUNNING with config/tournamentConfig divergence) —
including the CONFIGURED_PRE_START case that this correction fixes:
configuration and roster now survive instead of collapsing to
`tournament: null`.

## CURRENT — In-memory application store (M2I)

`src/application/tournamentStore.js`'s `createTournamentStore(initialApplicationState)`
owns one canonical `ApplicationState` value in memory: `getState()`,
`replaceState()`, `updateState()`, and one read-only query,
`getStandingsBeforeRound(roundLimit)`, which delegates to
`reconstructStandingsBeforeRound()`. It implements no tournament-lifecycle
commands yet. `PoolTournamentApp.jsx` does not use it.

`tests/tournament-store.test.js` covers: creating a store in each of the four
approved lifecycle modes (EMPTY, CONFIGURED_PRE_START, RUNNING, RUNNING with
a `preAdvanceSnapshot`), invalid initial state being rejected,
`getState()` returning an isolated copy on every call, mutating the initial
input or a `getState()`/`replaceState()` argument after the fact never
affecting the store, `replaceState()` rejecting invalid input while leaving
the previous valid state intact, `getStandingsBeforeRound()` producing exact,
independently-verified results for both a multi-round fixed-rack history and
a GBR_14.1 history (reusing the same known values as
`tests/before-round-standings.test.js`), that query never mutating store
state, throwing clearly for an EMPTY application, returning `{}` for a
CONFIGURED_PRE_START tournament with no participants yet, `config`/
`tournamentConfig` divergence and roster/`tournament.players` independence
both surviving store ownership, and the store's state always being plain
JSON-serializable with no functions anywhere in it. `updateState()` is
directly tested for: successful commit, isolated updater input, invalid/
undefined return atomicity, thrown-error atomicity, and post-commit
reference isolation.

## CURRENT — First application command: match table assignment (M2J)

`src/application/tournamentCommands.js`'s `assignMatchTable(applicationState, { roundNumber, matchId, table })`
is the first pure application command that changes tournament data — only a
single match's `tbl` field. `src/application/tournamentStore.js` now exposes
this directly as `store.assignMatchTable({ roundNumber, matchId, table })`,
committed through the store's existing `updateState()` boundary with no
separate validation/cloning/command logic of its own. No round-lifecycle/
pairing/BBS command exists yet.

`tests/tournament-commands.test.js` covers the pure command: assigning a
table to only the targeted match, overwriting an existing assignment,
preserving the exact type of the supplied value (number or string, never
coerced), accepting an empty value, changing no field other than `tbl`, a
completed match's table remaining changeable (matching the current UI, which
disables the input only for `cancelled`, not `done`), a cancelled match's
table still being changeable at the data layer (the current `disabled`
attribute is UI-only — nothing in `setAllRounds(...)` itself guards on
`cancelled`), the deliberate absence of table-uniqueness validation (matching
current code), no mutation of the input `ApplicationState`, no aliasing on
the changed object-graph path, no effect on players/roster/other rounds, the
result remaining a valid canonical `ApplicationState`, clear errors for an
EMPTY application/missing round/missing match, and composition with
`tournamentStore.updateState()`.

`tests/tournament-store.test.js` covers the store-level `assignMatchTable()`
method without re-deriving the pure command's semantics: a successful commit,
overwriting an existing assignment, a blank `''` value surviving, numeric and
string values preserving their type, a missing round/missing match/EMPTY
application each throwing with the store's state left completely unchanged,
only the targeted match changing (players/roster/pendingPlayers/config/
`tournamentConfig` all untouched — no recalculation), an existing
`preAdvanceSnapshot` left untouched (round-advance undo behavior is
unaffected by table assignment), `getState()` isolation still holding
afterward, the method working identically for a 14.1-formatted match and a
match with no `format` field at all (the command has no format branching),
and a numeric `roundNumber` correctly resolving a round whose canonical keys
are (post-JSON-clone) strings.

`npm test` currently passes 154/154 and `npm run build` passes.

## CURRENT — Tournament started lifecycle marker (M2K-A)

The canonical `Tournament` shape now has a required boolean `started` field, explicitly preserving whether Round 1 has started — the same distinction the legacy application currently encodes implicitly as `tournament === null` (not started) versus `tournament !== null` (started). It is never inferred from player/round counts, `currentRound`, match existence, or `pendingPlayers`; `validateTournamentState()` rejects any non-null Tournament missing a boolean `started`. `createTournamentState()` deliberately assigns it no default (unlike every other field), so every call site — including all pre-existing tests — must state it explicitly. `src/application/legacyStateAdapter.js` sets it per legacy mode: `started: false` for CONFIGURED_PRE_START, `started: true` for RUNNING; EMPTY still maps to `tournament: null`. `src/application/tournamentStore.js` required no code changes — `started` is preserved automatically by its existing generic clone/validate boundary. `started` is a lifecycle marker only: it does not gate or reset any other pre-start state, and pre-start config/tournamentConfig/roster/pendingPlayers edits remain fully independent of it.

`tests/tournament-model.test.js` (section H) covers: a Tournament with `started: false` validates, one with `started: true` validates, a non-null Tournament missing `started` is rejected, a non-boolean `started` is rejected, and JSON round-tripping preserves both `false` and `true` exactly.

`tests/legacy-state-adapter.test.js` (section F, plus assertions added to the existing state-mode matrix) covers: EMPTY still maps to `tournament: null`, CONFIGURED_PRE_START maps to `started: false`, RUNNING maps to `started: true`, a RUNNING tournament restored via undo still maps to `started: true`, and `config`/`tournamentConfig` divergence survives independently of `started`.

`tests/tournament-store.test.js` covers: the store accepting both a CONFIGURED_PRE_START (`started: false`) and a RUNNING (`started: true`) initial state, `getState()`/`replaceState()`/`updateState()` all preserving `started` across both modes, `assignMatchTable()` never changing `started`, an update that removes or corrupts `started` being rejected atomically (leaving the store's prior valid state unchanged), and pre-start editability: while `started: false`, a valid `updateState()` change to active `config`, to `tournamentConfig`, or to roster/`pendingPlayers` each commits successfully, leaves `started` at `false`, and leaves unrelated pre-start state untouched — proving pre-start state can evolve without starting or resetting the tournament.

`npm test` currently passes 169/169 and `npm run build` passes.

## CURRENT — Canonical-to-legacy compatibility projection (M2K-B)

`src/application/legacyStateAdapter.js`'s `projectApplicationStateToLegacy(applicationState)` is the reverse of `captureApplicationStateFromLegacy()`: canonical `ApplicationState` → the same eight legacy-shaped fields (`config`, `tournamentConfig`, `tournament`, `players`, `pendingPlayers`, `allRounds`, `currentRound`, `preAdvanceSnapshot`). It validates via the existing `validateApplicationState()`, throws before touching anything on invalid input, and returns a JSON-safe deep clone sharing no references with the input. It reads `Tournament.started` directly (M2K-A) to choose the legacy shape: `started: false` → legacy `tournament: null` with `config`/`tournamentConfig`/roster(→`players`)/`pendingPlayers`/`rounds`(→`allRounds`)/`currentRound` preserved exactly, nothing regenerated from defaults; `started: true` → a real `{ players, totalRounds }` legacy tournament object that never carries `started` itself (legacy represents the lifecycle fact purely through `tournament` nullity); canonical `tournament: null` (EMPTY) → the actual EMPTY legacy shape, with `config` deliberately omitted (canonical EMPTY state retains no config value to project — this mirrors the forward mapping's own EMPTY behavior, not a new loss). Round/match data (`rounds`/`allRounds`) is mapped, never normalized — no `createMatch()` reconstruction, so an absent `format`, both legacy bye encodings, numeric/string/blank `tbl`, and all 14.1 fields pass through unchanged. `preAdvanceSnapshot` is preserved verbatim (or `null`), still exactly the shape `confirmUndoAdvance()` reads directly. `PoolTournamentApp.jsx` is not called or modified by this module.

**`totalRounds` representability rule (M2K-B follow-up):** current legacy pre-start state has no field to hold `totalRounds` independently of `config.default_rounds` (there is no legacy `tournament` object before Round 1 starts — the real `startTournament()` always reads `config.default_rounds` live). A canonical `CONFIGURED_PRE_START` Tournament captured from real legacy state always has `totalRounds === config.default_rounds`, so that case projects cleanly and round-trips losslessly. An artificially constructed canonical Tournament where the two values have been made to disagree (possible only via M2K-A's `store.updateState()` pre-start editing, never via a real legacy capture) is **not representable** — `projectApplicationStateToLegacy()` throws a clear error rather than silently losing, rewriting, or regenerating either value, and leaves the canonical input completely unchanged. This restriction applies only to `started: false`: once `started: true`, legacy `tournament.totalRounds` exists independently, so `totalRounds` and `config.default_rounds` may legitimately diverge and are preserved separately, never synchronized.

`tests/legacy-state-projection.test.js` covers: `projectApplicationStateToLegacy()`'s basic contract (invalid input rejected without mutation, EMPTY/CONFIGURED_PRE_START/RUNNING shapes, `started` never leaking into the legacy tournament object, full clone/reference isolation); 18 legacy → canonical → legacy round-trip cases (EMPTY; CONFIGURED_PRE_START; RUNNING fixed-rack and 14.1; RUNNING with an undo snapshot; diverged `config`/`tournamentConfig`; independent roster/`tournament.players`; `pendingPlayers`; a format-less Manual Pairing Editor match; an automatic `createPairings()` match; both bye encodings; numeric/string/blank `tbl`; 14.1 target/points/innings/high-run fields; `removed`/`joinedRound`; a transient promoted-player shape; and round object keys surviving JSON serialization); 7 canonical → legacy → canonical cases (EMPTY, CONFIGURED_PRE_START, RUNNING, RUNNING with undo, `config`/`tournamentConfig` divergence, `started: false` preserved, `started: true` preserved); the `totalRounds` representability pair — test A (a representable pre-start Tournament projects and round-trips losslessly) and test B (a contradictory pre-start Tournament is rejected with a clear error and the canonical input is left unchanged); a dedicated RUNNING test proving `totalRounds`/`config.default_rounds` divergence is preserved, not rejected or synchronized, once `started: true`; and four pre-start director-edit-preservation tests proving projection reflects current (not reconstructed/default) `config`, `tournamentConfig`, roster/`pendingPlayers`, and `rounds`/`currentRound` values while `started` stays `false`.

`npm test` currently passes 204/204 and `npm run build` passes.

## CURRENT — Canonical startTournament application command (M2L)

`src/domain/pairing.js`'s `generatePairings()` is a faithful, unmodified extraction of `PoolTournamentApp.jsx`'s `createPairings()` — bye assignment (whitepaper §9.2), Round-1-only direct-pairing seed methods (`random`/`cross_elo`/`manual`), Swiss/cost-based pairing (every other round, and Round 1 with `'elo'`/unrecognized seeding), table numbering, and 14.1 tier-target stamping, all reproduced exactly with no formula changes. `tests/pairing.test.js` covers each seed method's actual pairing order (including the real asymmetry that `'elo'` seeding sorts the roster but still pairs via Swiss/cost-based logic, not direct 1v2), bye assignment and the `null`-on-no-legal-bye signal, default vs. explicit `tableNumbers` (including the two falsy-but-present cases `0` and `''`, which the legacy `tableNumbers[...] || fallback` expression treats as "use the fallback" exactly like a missing entry), fixed-rack vs. 14.1 match shape, match id/field types, and input immutability — 18 tests.

`src/application/tournamentCommands.js`'s `startTournament(applicationState, { seedMethod, manualSeeding, tableNumbers })` is the canonical application-layer equivalent of current legacy `startTournament()`, verified against direct source inspection (see that command's own extensive header comment for the full characterization, including the discovered `setTournament()`-before-bye-check ordering quirk — unreachable through normal current UI-created pre-start state, but reachable for a structurally valid artificial canonical pre-start state, in which case this command rejects atomically rather than reproducing legacy's theoretical partial-commit ordering bug; see the dedicated artificial-prior-bye test below). It requires `tournament.started === false`, transitions `started: false → true` explicitly on success, captures `totalRounds` from the current `tournament.config.default_rounds`, builds `tournament.players` from `tournament.roster` in the exact minimal transient shape current `startTournament()` itself writes (not the post-`recalc()` steady-state shape — `recalc()` is a separate, not-yet-extracted mechanism, out of scope here), generates Round 1 via `generatePairings()`, and leaves `pendingPlayers`/`config`/`tournamentConfig`/`preAdvanceSnapshot` completely untouched. `src/application/tournamentStore.js` exposes this as `store.startTournament(args)` via the same thin `updateState()` wrapper pattern as `assignMatchTable`.

`tests/tournament-commands.test.js` covers the pure command: the `started: false → true` transition, `totalRounds` capture, `currentRound` becoming 1, `tournament.players` built from the roster (roster itself untouched) with roster elo as starting GBR, the exact minimal transient player shape, `pendingPlayers` preservation (including pre-start roster duplication), `config`/`tournamentConfig` preservation, Round 1 generation (match count, wholesale-replacing any stray prior `rounds` content), table assignment (default and explicit), bye behavior, fixed-rack and 14.1 formats, input immutability, output validity, rejections (EMPTY, already-started, missing `seedMethod`), plus additional characterized semantics found during source inspection (`cross_elo`/`manual`/unrecognized-seedMethod pairing order, a zero-player roster "succeeding" with no guard, since current legacy has none). It also covers the artificial (not UI-reachable) no-legal-bye boundary — a structurally valid but artificial pre-start Tournament whose `rounds` records prior round history marking every player bye-ineligible rejects atomically, leaving the input completely unchanged — and a historical-14.1-Cross-GBR pin (A/B/C/D at GBR 700/600/500/400 under `seedMethod: 'cross_elo'` pair A-vs-C and B-vs-D deterministically, with correct 14.1 match shape/targets), confirming the seed method the director has identified as the historical replay tournament's actual seeding — 27 tests, alongside the existing `assignMatchTable` coverage.

`tests/tournament-store.test.js` adds store-level coverage: a successful start committing and `started` becoming `true`, a failed start (missing `seedMethod`, already-RUNNING, EMPTY) throwing and leaving store state completely unchanged, `getState()` isolation holding afterward, unrelated `config`/`tournamentConfig`/roster values surviving unchanged, `assignMatchTable()` continuing to work normally on a store after `startTournament()`, and the same artificial-prior-bye boundary failing atomically at the store level — 8 tests.

`tests/start-tournament-crosscheck.test.js` cross-checks the full boundary — not just the pure command in isolation — against behavior characterized from the legacy source: a representative legacy CONFIGURED_PRE_START state run through `captureApplicationStateFromLegacy() → startTournament() → projectApplicationStateToLegacy()` produces a legacy-shaped result matching that characterization for players, `totalRounds`, `currentRound`, Round 1 matches (fixed-rack and 14.1), table assignment, bye handling, and `pendingPlayers` — 4 tests. This is not an independently executable legacy oracle (no React/legacy component runs in the test suite), so it does not prove byte-for-byte equality against an independently run legacy implementation.

**Recalculation is out of scope for M2L, characterized not implemented:** in the real running app, `startTournament()`'s `setTournament(...)`/`setAllRounds(...)` calls trigger the existing `recalc()` `useEffect`, which further normalizes `tournament.players` into the full steady-state shape (adding `perfCount`/`racksWon`/`racksLost`/`rp`/14.1 aggregate fields, and applying any Round-1 bye's match-point contribution). `recalc()` is a separate, general-purpose mechanism that reacts identically to every round-lifecycle change, not something specific to starting a tournament — extracting a pure equivalent (including RP accrual, which the already-extracted `reconstructStandingsBeforeRound()` deliberately does not track) is recommended future scope, not part of M2L.

`npm test` currently passes 261/261 and `npm run build` passes.

## CURRENT — Pure full-history tournament recalculation (M2M-A)

`src/domain/tournamentRecalculation.js`'s `recalculateTournamentPlayers({ players, roster, rounds, currentRound, config })` is a pure extraction of `PoolTournamentApp.jsx`'s `recalc()`, verified against direct source inspection (see that module's own extensive header comment for the full characterization, including two reported discrepancies against existing extracted domain helpers — see docs/ARCHITECTURE.md). It replays stored rounds `1..currentRound` (never every key present in `rounds`) in stored array order, evolving GBR sequentially; reads starting GBR from `roster` via the same plain-object, string-coerced, last-write-wins lookup `recalc()` itself uses; resets every player to the full steady-state shape (including the 14.1 aggregate fields, unconditionally, regardless of format) at the start of every replay; reuses `applyFixedRackMatch()` for the non-bye fixed-rack path (including format-less matches) and `straightPoolMatchOutcome()` for the non-bye 14.1 path (reading `match.target` exactly as historically stored, never recomputed from current tier config); RP accrual is symmetric and config-gated; cancelled/incomplete matches are skipped; `removed`/`joinedRound` pass through unchanged (recalc() does not filter or gate on either).

**AUTHORITATIVE BBS RULE — bye/FREILOS (director-confirmed correction):** a bye is checked and handled FIRST, before format, via this module's own dedicated `applyByeMatch()` — the ONE deliberate divergence from legacy `recalc()` in this module. A bye awards +1 MP and the normal RP compensation for a round played with 1 MP/a win (`rp_per_round + 1 * rp_per_mp`, zero GBR-change RP component), but does **NOT** increment `games`, and does not touch GBR, PERF, `perfCount`, racks/points/innings/NPD/high-run, or opponent history, for either format. The original M2M-A extraction faithfully reproduced legacy's actual `games + 1` bye accrual (via `applyFixedRackMatch()`, shared with the still-running `PoolTournamentApp.jsx`); the RP behavior was already correct. `applyFixedRackMatch()`/legacy `recalc()` are untouched and still increment games for a bye — only `recalculateTournamentPlayers()`'s own bye path changed. See docs/ARCHITECTURE.md and docs/BBS.md for the full rule statement, and the new, explicit divergence this creates against `reconstructStandingsBeforeRound()` (which still increments `games` for a bye, unchanged, out of scope for this correction).

`rounds` is consumed strictly read-only — this function has no way to add, remove, or reorder a match, table assignment, or historical target, matching the hard product rule that recalculation never re-pairs. React still uses its own `recalc()` and is not wired to this module yet.

`tests/tournament-recalculation.test.js` covers: empty history; a single fixed-rack match's MP/racks/PERF/GBR/games/opps/RP computed via the shared domain formulas; multiple sequential rounds proving GBR evolves match-by-match (not from a single final computation, with an explicit non-sequential-would-differ sanity check); a format-less (Manual Pairing Editor) match still treated as fixed-rack; the 14.1 equivalents of all of the above, including the stored-target-not-recomputed proof and the no-stored-target fallback; the corrected fixed-rack and 14.1 bye handling (both stored bye encodings, `use_rp: true` and `use_rp: false`, no games increment in either format); cancelled and incomplete match skipping; RP disabled via `config.use_rp: false` and repeated-opponent RP/`opps`-dedup behavior; starting GBR from the roster overriding a player's stale current elo; a roster-absent player falling back to their own elo; the duplicate/colliding-roster-id last-write-wins quirk; `joinedRound` pass-through without replay gating; the full steady-state field set always being present; full input immutability (players/roster/rounds/config all byte-unchanged afterward, proving rounds/pairings are untouched); replay idempotence (recalculating twice, including feeding an already-recalculated `players` array back in, produces the identical result — proving it replays from history rather than stacking on derived numbers); consistency with `reconstructStandingsBeforeRound()` on every overlapping field for representative fixed-rack and 14.1 histories, plus a dedicated test proving and documenting the new, intentional bye-`games` divergence between the two; round-number bounds (a round beyond `currentRound`, and a round keyed below 1, are both never replayed); the config-history CURRENT-legacy-compatibility behavior (changing active config retroactively changes already-played rounds' derived numbers); and the discovered missing-player-throws quirk for both formats — 31 tests.

`tests/historical-14-1-recalculation.test.js` cross-checks the real `vm-joes-14-1` historical fixture: match points, games, aggregate points for/against, and high run — every field independently verifiable without knowing the fixture's exact historical GBR/PERF configuration (per that fixture's own `metadata.json`, which explicitly marks exact formula/configuration reproduction as `NOT_TESTABLE`) — all match the recorded final table for every one of the 10 players, including the two players with no recorded Round 5 match correctly ending with 4 games instead of 5. GBR/PERF/RP are deliberately not cross-checked here, since recalculating them would require configuration this fixture does not preserve — 2 tests.

## CURRENT — Canonical match result entry/correction (M2M-B)

`src/application/tournamentCommands.js`'s `recordMatchResult(applicationState, { roundNumber, matchId, r1, r2, p1Points, p2Points, innings, p1HighRun, p2HighRun })` is the canonical application-layer equivalent of current legacy `completeMatch()`, verified against direct source inspection (see that command's own extensive header comment for the full characterization). It requires a real RUNNING tournament (`started === true`); dispatches on the existing match's own stored `format` (never on which arguments were supplied); collapses legacy's two-step stage-then-complete UI flow into one atomic validate → finalize → `done: true` → recalculate command, usable identically for first entry and for correction (legacy's `completeMatch()` has no precondition on the match's prior `done` value either). Fixed-rack (and format-less) matches reproduce the exact auto-complete-one-missing-side logic and the strict `r1 + r2 === config.max_games` total check; 14.1 matches reproduce all four of `completeMatch()`'s validation guards in the same order, and mirror the finalized points onto `r1`/`r2` exactly like legacy's own "kept for compatibility" comment. **RECALCULATION != RE-PAIRING**: on success, only the approved result fields on exactly one match change, followed by a call to `recalculateTournamentPlayers()` with the updated rounds — `p1`/`p2`/`tbl`/`target`/`format`/`id`/`bye` are never touched, no pairing module is invoked, and no other match or round is altered. A bye match is rejected explicitly (current legacy renders no result input for a bye at all, not merely a disabled one). A cancelled match has no guard, mirroring `completeMatch()`'s own lack of one (the same "UI attribute, not a data-layer rule" pattern already established for `assignMatchTable()`) — harmless in practice since `recalculateTournamentPlayers()` already ignores any cancelled match. `src/application/tournamentStore.js` exposes this as `store.recordMatchResult(args)` via the same thin `updateState()` wrapper pattern as the other two commands. React is still not wired to this command.

`tests/record-match-result.test.js` covers the pure command for both formats: initial entry and completion semantics; fixed-rack MP/racks/PERF/GBR/games/opponents recalculation; the single-missing-side auto-complete; the total-racks and zero-score rejections; correcting an already-done result (both formats) recalculating from the new values; a Round 1 correction leaving later stored rounds structurally unchanged; table/p1/p2/id/order preservation; a format-less match still taking the fixed-rack path; missing round/match/EMPTY/not-started rejections; full input immutability including on failure; 14.1 points/innings/high-run entry and all four of `completeMatch()`'s validation rejections (in the same order); the TD-override (neither player reaching target) still completing without rejection; 14.1 correction preserving the historically stored target even against a divergent current tier config; an earlier 14.1 round correction leaving later rounds unchanged; explicit bye rejection for BOTH stored bye encodings (automatic `r1:0/r2:0` and Manual Pairing Editor `r1:max_games/r2:0`); the cancelled-match-not-guarded-but-still-ignored-by-recalc proof; a dedicated result-field whitelist test (p1/p2/tbl/target/format/id/bye/cancelled all unchanged) plus an unapproved custom field surviving untouched; full `ApplicationState`/`Tournament` field preservation (started/config/tournamentConfig/roster/pendingPlayers/currentRound/totalRounds/preAdvanceSnapshot, and the untouched sibling match in the same round); and output validity — 30 tests.

**CORRECTED NUMERIC INPUT CONTRACT (follow-up fix):** the original `recordMatchResult()` used `Number(value) || 0` on every numeric result field, mirroring `completeMatch()`'s own redundant re-parse — but legacy's real end-to-end pipeline is three-part: its `<input onChange>` handlers stage values via `parseInt(...) || 0` (always producing an integer) *before* they ever reach `completeMatch()`, so legacy can never actually persist a fractional score. Skipping that staging step meant this command's `Number(...) || 0` alone would accept a raw decimal — e.g. `r1: 4.9, r2: 1.1` passes the `!== 0` OR-fallback check untouched and coincidentally satisfies `4.9 + 1.1 === 6`, producing a stored fractional result no legacy code path could ever create. `recordMatchResult()` now requires every authoritative numeric field (`r1`, `r2`, `p1Points`, `p2Points`, `innings`, `p1HighRun`, `p2HighRun`) to already be `Number.isInteger(...)`-true — no `Number(...)` coercion, no `parseInt(...)`, anywhere in the command; integer-staging is the caller's responsibility, matching what legacy's own input handlers already guarantee before `completeMatch()` runs. `assignMatchTable()` (`table`: number/string/blank) is entirely unaffected. `tests/record-match-result.test.js` adds 15 tests covering both formats' integer/string/decimal/NaN/Infinity/null/object rejections, the exact `4.9`/`1.1` exploit scenario, and a full store-level atomicity matrix (pre-start, missing round, missing match, invalid 14.1, both bye encodings, invalid non-integer result) all failing with store state left completely unchanged.

`tests/tournament-store.test.js` adds store-level coverage for `recordMatchResult`: a successful commit recalculating `tournament.players`, a failed commit (invalid total) throwing and leaving store state completely unchanged, an EMPTY application throwing, `getState()` isolation holding afterward, and `assignMatchTable()` continuing to work normally on a store after a result is recorded — 5 tests.

`tests/historical-14-1-correction.test.js` cross-checks the real `vm-joes-14-1` fixture: builds the full 5-round stored history, corrects the first recorded Round 1 result, and proves both involved players' recalculated MP/GBR change while every match in Rounds 2–5 (and every other Round 1 match) remains byte-for-byte structurally identical — no pairing/re-pairing occurs. Historical Round 1 was seeded with Cross GBR (`cross_elo`), but this test (like the command itself) never calls pairing and treats the stored matchups as authoritative history — 1 test.

`npm test` currently passes 345/345 and `npm run build` passes.

## FUTURE — Reference tournament / golden master

Not required to close M1. A completed historical tournament replayed end-to-end
against expected final standings/ratings would still strengthen the regression
baseline and remains possible future work.

A preferred fixture contains:

```text
tests/fixtures/reference-tournament/
  tournament.json
  players.json
  matches.json
  expected-standings.json
  expected-ratings.json        # when available
  README.md
```

The exact file format should follow the codebase once this fixture is built; this diagram is conceptual rather than mandatory.

## Reproduction rules

### Must match exactly

Where the underlying data is deterministic, require exact agreement:

- entrant identity/order where relevant;
- rounds already played;
- pairings when replayed from identical state;
- bye assignment;
- wins/draws/losses;
- match points;
- racks for/against;
- rack differential;
- final standings order.

### Floating-point/calculated values

GBR/PERF calculations may be represented internally as floating-point numbers.

The default acceptance rule is:

- exact agreement after the application's defined display rounding; or
- a small documented numerical tolerance where raw floating-point representation requires it.

There must be **no unexplained tournament-significant discrepancy** hidden by a broad tolerance.

## Required engine tests as code is extracted

Add focused regression/unit tests for at least:

- expected-score calculation;
- GBR match/rack components and total update;
- zero-sum rating updates;
- PERF including perfect/zero-score caps;
- match-point interpretation;
- standings comparison;
- pairing comparison/order;
- repeat-opponent penalty behavior;
- bye eligibility and scoring;
- recalculation from match history.

Experimental formats should have their own isolated tests and must not weaken stable fixed-rack assertions.

## Architecture tests

As M2 develops, add tests for boundaries and contracts:

- backend/API state read/write behavior;
- persistence and reload;
- frontend service contract;
- public/live views reading authoritative state;
- invalid score/update handling.

## Live/event tests

Before M5, test event-operational scenarios rather than only functions:

- enter rack `+1`, verify public state;
- undo/correct rack `-1`, verify public state;
- finish a match, verify standings;
- restart browser/application, verify state persists;
- temporary internet loss, verify local administration remains recoverable;
- restore from backup/export;
- complete a rehearsal tournament end to end.

## Build gate

Once test tooling exists, normal code tasks should finish with:

```bash
npm test
npm run build
```

A failing regression test is a blocker for refactoring unless the task explicitly changes the expected BBS behavior and the change has been approved/documented.

## Reference data discipline

Historical expected results are test evidence, not disposable generated output.

Do not update expected fixtures merely to make a failing test green. Any fixture change must explain why the previous expected result was wrong or why the specification intentionally changed.
