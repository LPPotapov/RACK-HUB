# RACK HUB Testing Strategy

## Purpose

The highest-risk failure in RACK HUB is not a visual bug. It is silently changing tournament outcomes while restructuring the legacy application.

Testing therefore begins with behavioral reproduction before large refactoring.

## M1 — Reference tournament / golden master

A completed historical tournament will become the permanent baseline fixture.

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

The exact file format should follow the codebase once M1 begins; this diagram is conceptual rather than mandatory.

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
