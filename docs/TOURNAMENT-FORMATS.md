# Tournament Formats

## Design objective

RACK HUB should support reusable tournament structures rather than a collection of event-specific forks.

A named event such as the Canaletto Cup should be represented primarily as a **preset/configuration** of supported stages and rules.

## Stable BBS fixed-rack format

The first protected format is the stable fixed-rack BBS workflow defined by the BBS whitepaper and legacy implementation.

Relevant concepts include:

- Swiss-style rounds;
- BBS pairing behavior;
- MP, PERF, and optional Rack Differential standings behavior;
- byes;
- GBR updates;
- fixed-rack match results.

Any refactoring of this format must pass the M1 reference-tournament baseline.

## TARGET — Multi-stage tournament model

M4 introduces tournaments composed of stages.

Conceptually:

```text
Tournament
  |
  +-- Stage 1: BBS / Swiss-style competition
  |
  +-- Qualification rule
  |
  +-- Stage 2: Single-elimination bracket
```

Stage configuration should carry the parameters needed by that stage instead of scattering tournament-name conditions across UI and engine code.

## Canaletto preset

The agreed Canaletto direction is:

```text
Group / BBS Swiss-style stage
            |
            | qualify Top N
            v
Single-elimination knockout stage
```

For the current event:

- `N = 16`;
- the knockout phase is single elimination.

The precise cross-group qualification/seeding algorithm must be documented when finalized. Until then it is **TBD** and must not be silently invented in code.

## Knockout stage requirements

The knockout model should support:

- generated bracket slots;
- seeds/qualifiers entering the bracket;
- round-of-16, quarterfinal, semifinal, and final progression for a 16-player bracket;
- match result correction before progression is irreversibly committed;
- public bracket representation;
- admin bracket controls;
- later use with different Top-N sizes where structurally valid.

## Presets versus engine

A preset should provide convenient defaults, for example:

```text
Canaletto 2026
  -> BBS-stage configuration
  -> qualification count
  -> knockout-stage configuration
  -> display defaults
```

It should not duplicate the BBS engine or bracket engine.

## FUTURE formats

Possible future presets/formats include:

- standard BBS tournament;
- BBS + single KO;
- additional fixed-rack configurations;
- straight-pool/14.1 after its rules/model become stable;
- other cue-sports tournament stages.

These are future possibilities, not promises for the event-ready release.
