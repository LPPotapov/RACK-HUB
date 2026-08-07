# ADR 0003 — Model Canaletto as a reusable multi-stage tournament

**Status:** Accepted

## Context

The Canaletto format requires a BBS Swiss-style/group stage followed by a Top-N knockout phase. Implementing the event through event-name-specific conditions would make RACK HUB difficult to reuse for future tournaments.

## Decision

RACK HUB will model tournaments as one or more stages with explicit progression/qualification rules.

The Canaletto event will be implemented as a preset/configuration using:

1. a BBS Swiss-style first stage;
2. a qualification rule;
3. a Top-N single-elimination stage.

For the current Canaletto use case, N is 16.

The precise cross-group seeding/qualification ordering remains to be documented when agreed.

## Consequences

- Canaletto-specific settings can exist without forking tournament engines.
- Other BBS + knockout tournaments can reuse the same structure.
- Stage-transition logic becomes an explicit domain concern.
- Bracket progression and its display become reusable features rather than event-only code.
