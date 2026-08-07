# RACK HUB Architecture

## Status legend

- **CURRENT** — implemented now.
- **TARGET** — agreed architecture for an upcoming milestone.
- **FUTURE** — possible later extension.

## CURRENT — Legacy baseline

The inherited BBS application is a self-contained React frontend. The whitepaper describes browser-local tournament state, `localStorage` crash recovery, and browser file APIs, with no backend required for the alpha workflow.

The legacy application is valuable as a working reference, but this architecture cannot provide the shared authoritative state required for public live pages, multiple views, centralized history, or production multi-device operation.

During M0, the primary goal is only to make this application run in a conventional project. A large React component is temporarily acceptable.

## TARGET — Three architectural concerns

RACK HUB separates three concerns:

```text
+--------------------+
| FRONTEND           |
| admin / live / OBS |
+---------+----------+
          |
          | API / service contract
          v
+--------------------+
| BACKEND            |
| authoritative state|
| persistence        |
| publication        |
+---------+----------+
          |
          | invokes domain logic
          v
+--------------------+
| DOMAIN / BBS ENGINE|
| ratings            |
| performance        |
| standings          |
| pairings / byes    |
| stage progression  |
+--------------------+
```

The domain layer is not a "backend" simply because it contains calculations. It is shared business logic and should be usable without HTTP, React, or browser APIs.

## Domain / engine boundary

### Responsibilities

The engine owns deterministic tournament logic, including as applicable:

- BBS expected score and GBR updates;
- PERF calculation;
- fixed-rack result interpretation;
- standings ordering;
- Swiss-style pairing;
- bye eligibility/selection;
- tournament/stage progression rules;
- knockout bracket progression once implemented.

### Constraints

Domain modules must not depend on:

- React components/hooks;
- DOM APIs;
- browser localStorage;
- HTTP requests;
- OBS/browser-source concerns;
- visual formatting.

A calculation should ideally be testable as a pure function given explicit input.

## Backend boundary

### TARGET responsibilities

The backend owns authoritative tournament state and publication concerns:

- current tournament configuration;
- entrants;
- rounds/matches/results;
- active stage;
- persistence;
- API used by admin and public clients;
- later: persistent tournament/player history.

The initial local backend may be intentionally small. Architecture should favor transparency and reliability over infrastructure complexity.

### State rule

Once M2 is complete, browser-local React state must not be the sole authoritative record of an active tournament.

See ADR 0002.

## Frontend boundary

Frontend code is split by purpose, not by separate mathematical implementations.

Expected surfaces include:

- admin/tournament-director UI;
- spectator live pages;
- OBS/browser-source overlays;
- bracket display;
- later archive and player/rating pages.

Frontend responsibilities include:

- forms and controls;
- fast result entry;
- layout and visualization;
- displaying data returned by the backend/engine;
- user-friendly validation and error states.

The frontend must not contain a second authoritative implementation of GBR/PERF/pairing logic.

## TARGET — Live data flow

```text
Admin UI
   |
   | result/state update
   v
Backend authoritative state
   |          |             |
   v          v             v
/live    /overlay/...   bracket/public views
```

Polling is acceptable for the first live skeleton. WebSockets or other push technology should only be introduced when a measured need justifies them.

## TARGET — Repository direction

Exact folders may evolve during M0–M2, but the intended separation is similar to:

```text
src/
  engine/          # pure domain/BBS logic
  frontend/        # React application and pages
  services/        # client-side API/service adapters
server/            # backend/API implementation
tests/             # unit/integration/reference fixtures
docs/              # project documentation
legacy/            # immutable historical implementation
```

Do not reorganize solely to match this diagram. Each extraction should be backed by tests and performed incrementally.

## FUTURE — Persistent platform

The platform phase will require durable records for tournaments, players, ratings, and rating history. The final persistence technology is deliberately not locked in during M0.

The API/domain boundaries should make it possible to replace a local development store with production persistence without rewriting tournament logic or presentation components.

## Architectural invariants

1. BBS logic remains explainable and regression-tested.
2. Authoritative tournament state has one owner.
3. Public and broadcast pages consume the same state as admin.
4. Event presets configure reusable formats rather than fork the product.
5. Deployment choices must not leak deeply into domain code.
6. Documentation must distinguish implemented state from planned state.
