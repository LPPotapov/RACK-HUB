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

`npm test` currently passes 126/126 and `npm run build` passes.

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
