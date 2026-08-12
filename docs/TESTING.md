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

`npm test` currently passes 43/43 (11 M1 fixed-rack/historical + 32 14.1
characterization) and `npm run build` passes.

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
