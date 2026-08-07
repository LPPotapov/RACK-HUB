# RACK HUB Vision

## Purpose

RACK HUB is intended to become a practical tournament-management, live-scoring, broadcast, and archive platform for cue-sports events.

The product is intentionally distinct from the **Batforce Billiards System (BBS)**. BBS describes tournament/rating methodology; RACK HUB is software that can implement BBS and, over time, additional tournament structures.

## Near-term objective

The immediate priority is not feature completeness. It is to make the existing tournament workflow reliable enough to run a real event while creating an architecture that does not have to be thrown away afterward.

The development sequence is therefore:

1. reproduce the legacy application in a proper software project;
2. prove its tournament output against a completed historical event;
3. separate domain logic, backend state, and frontend presentation;
4. create live/public/broadcast views on top of that backend;
5. add the Canaletto hybrid format;
6. deploy the minimum event-ready system for live tournament use;
7. broaden RACK HUB into a reusable tournament platform.

## Product principles

### 1. Tournament correctness before visual polish

The system must preserve BBS behavior and tournament state reliably before large UI redesigns or convenience features are introduced.

### 2. Local control with a path to public publication

Tournament administration should remain practical on a local tournament machine. Public scores, standings, brackets, and broadcast views should be publishable without moving authoritative tournament operation into fragile browser-only state.

### 3. One authoritative state

Admin controls, public live pages, and OBS/browser overlays should ultimately represent the same backend-held tournament state.

### 4. Reusable formats, not one-off event code

The Canaletto Cup is the first important hybrid-format use case, not the final shape of the product. Event-specific presets should configure reusable tournament stages rather than create a separate hard-coded application.

### 5. History should outlive the event

Long term, RACK HUB should provide a central home for:

- current live tournaments;
- completed tournament results;
- historical brackets and standings;
- persistent player/GBR history.

The public site should still be useful when no tournament is currently running.

### 6. Manual operation is acceptable when it is the safest event solution

For the first production event, manual score input from BillardPad into RACK HUB is an acceptable intermediary solution. Fast, low-friction correction and rack-entry controls are more important than premature integration work.

## Event-ready vision

For the first live deployment, the tournament director runs the administrative RACK HUB application locally and manually updates match scores. RACK HUB publishes that state so spectators and broadcasts can see live information over the internet.

Conceptually:

```text
BillardPad / reported results
           |
           v
Tournament director
           |
           v
Local RACK HUB admin
           |
           v
RACK HUB backend/state
      |        |        |
      v        v        v
 live page  standings  OBS views
```

Automated BillardPad input is FUTURE work and must not block the event-ready milestone.

## Long-term vision

RACK HUB should eventually allow a tournament director to:

- create a tournament;
- select or customize a format/preset;
- register players;
- run BBS Swiss-style stages;
- run knockout stages;
- enter or receive scores;
- publish live information;
- close the tournament;
- preserve results and rating history permanently.

A central public RACK HUB page can then act as both the live destination for current events and the archive for previous ones.
