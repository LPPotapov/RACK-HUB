# ADR 0004 — Repository is canonical; AI agents are contributors

**Status:** Accepted

## Context

RACK HUB will be developed with assistance from Claude Code and Codex. Separate AI-generated artifacts or parallel uncontrolled versions would make ownership, review, and rollback difficult.

## Decision

The Git repository is the authoritative product.

Claude Code, Codex, and human developers edit the same repository through normal branches and diffs.

For significant work:

- one agent implements at a time on a focused branch;
- tests/build are run;
- high-risk changes may receive independent review from the other agent;
- the project owner reviews before merge;
- `main` remains working.

## Consequences

- No "Claude version" and "Codex version" of RACK HUB exist.
- Agent output is reviewable and reversible through Git.
- Second-agent review is reserved mainly for high-risk tournament logic rather than duplicating all work and subscription usage.
- Agents must not commit/push unless explicitly authorized.
