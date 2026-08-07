# ADR 0001 — Separate the BBS/domain engine from UI concerns

**Status:** Accepted

## Context

The legacy application combines tournament calculations, state handling, and React presentation in a very large frontend source file. This makes mathematical behavior difficult to test independently and makes future backend/public-live work harder.

## Decision

RACK HUB will progressively extract deterministic tournament/BBS logic into domain/engine modules that do not depend on React, DOM/browser APIs, HTTP, or OBS.

Extraction will be incremental and protected by regression tests rather than a one-shot rewrite.

## Consequences

- BBS calculations become directly testable.
- Frontend redesigns cannot silently redefine tournament mathematics.
- Backend code can invoke the same domain behavior.
- Temporary duplication may exist during staged extraction, but authoritative logic should converge into the domain layer.
- M1 regression protection is required before high-risk extraction work.
