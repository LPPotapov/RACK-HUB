# BBS inside RACK HUB

## Purpose of this document

RACK HUB and the Batforce Billiards System are related but different things.

- **Batforce Billiards System (BBS)** — tournament/rating methodology.
- **RACK HUB** — software platform that implements BBS and other tournament-management capabilities.

The BBS whitepaper describes a proof-of-concept hybrid system for local fixed-rack pool tournaments, combining Swiss-style tournament operation with GBR, PERF, pairing, bye handling, correction tools, crash recovery, and exports.

## Source hierarchy for stable fixed-rack behavior

During the migration/refactor period use this hierarchy:

1. **BBS whitepaper v1.91** — normative specification for stable fixed-rack BBS behavior.
2. **Legacy React implementation** — working behavior reference and source of implementation details/bug fixes.
3. **Regression tests/reference tournament** — executable protection against accidental behavioral drift.

If these sources disagree, do not silently reconcile the difference. Record the discrepancy and require an explicit decision.

## Stable fixed-rack behaviors that require protection

The whitepaper defines, among other things:

- fixed-rack match points: win 1, draw 0.5, loss 0;
- GBR as an Elo-derived zero-sum rating update combining match outcome and rack-level outcome;
- PERF as opponent-adjusted tournament performance information;
- standard pairing order based on MP then PERF, with deterministic ID ordering used as a final stable tie-break in the implementation;
- standard pairing separated from final standings;
- Classic standings based on MP then PERF;
- Rack Differential standings based on MP, then RD, then PERF;
- byes worth 1 MP with no rack result, GBR change, or PERF contribution;
- repeated byes prohibited while an eligible player without a bye exists;
- derived tournament statistics recalculated from match history when results change.

The implementation should preserve the exact documented formulas and constants unless a separate, explicitly approved BBS revision changes them.

## Legacy architecture versus RACK HUB architecture

The whitepaper intentionally describes a browser-local React proof of concept using local state and `localStorage`. It also states that backend development is needed for production multi-user scenarios, persistent player data, centralized history, and tournament archives.

RACK HUB therefore changes the **software architecture** without automatically changing the **BBS methodology**.

This distinction is essential:

```text
Allowed architectural evolution:
legacy browser state -> backend authoritative state
single giant component -> modular domain + UI
local-only display -> public live/OBS views

Not automatically allowed:
changing GBR formula
changing PERF formula
changing pairing priorities
changing bye semantics
changing standings rules
```

## Experimental 14.1 behavior

The current legacy source contains experimental straight-pool/14.1 behavior that is not part of the stable fixed-rack v1.91 whitepaper specification.

Treat it as experimental and isolate it from stable fixed-rack BBS behavior. Do not use experimental 14.1 code as evidence for changing fixed-rack rules.

## Changes to BBS itself

A genuine methodology change should be handled deliberately:

1. describe the proposed rule/formula change;
2. identify affected calculations and tournament outcomes;
3. add or update tests;
4. document migration/compatibility implications;
5. update the BBS specification/version if accepted;
6. only then implement it in RACK HUB.

Normal refactoring tasks must not become accidental methodology revisions.
