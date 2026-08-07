# ADR 0002 — Backend owns authoritative tournament state

**Status:** Accepted

## Context

The legacy browser-local architecture can recover state in one browser but cannot reliably provide shared public live views, OBS views, centralized history, or multi-device continuity.

RACK HUB needs multiple surfaces to display the same tournament without manual duplication.

## Decision

After the M2 separation is complete, the backend/state service will be the authoritative owner of active tournament state.

Admin, live, bracket, and broadcast views will read/write through a defined service/API contract rather than independently maintaining authoritative copies.

The BBS/domain engine remains a separate concern from the backend transport/persistence layer.

## Consequences

- Public and OBS views can represent the same state as the admin UI.
- Browser refresh is no longer equivalent to losing authoritative tournament state.
- Local development can later be mapped onto hosted deployment without rewriting tournament logic.
- Persistence, backup, validation, and mutation authorization become explicit backend responsibilities.
