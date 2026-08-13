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

`npm test` currently passes 83/83 and `npm run build` passes.

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
