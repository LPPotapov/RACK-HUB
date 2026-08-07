# Live and Broadcast Architecture

## Goal

RACK HUB should publish tournament state to spectators and broadcast tools without requiring the tournament director to re-enter the same information in multiple places.

## CURRENT

The legacy application is browser-local. Shared live/public views are not yet the authoritative production architecture.

## TARGET — M3 localhost skeleton

The first live milestone works entirely on the local development machine.

Initial routes:

- `/admin` — tournament control and score entry;
- `/live` — spectator-oriented live information;
- `/overlay/match` — OBS/browser-source current-match view;
- `/overlay/standings` — OBS/browser-source standings view.

M4 adds bracket-oriented views such as `/live/bracket` and, where useful, `/overlay/bracket`.

## Data-flow rule

All live surfaces consume the same authoritative tournament state:

```text
                  +------------------+
                  | Admin UI         |
                  +--------+---------+
                           |
                           | update
                           v
                  +------------------+
                  | Backend / state  |
                  +--+-----------+---+
                     |           |
          +----------+           +------------+
          v                                   v
     Public live                           OBS views
```

A public page must never require a second manual copy of tournament data.

## Update mechanism

For M3, simple polling (for example approximately once per second) is acceptable if it is reliable and easy to debug.

Do not introduce WebSockets merely because they are more "real time." Revisit push technology only when polling creates a concrete problem.

## OBS/browser-source requirements

Overlay pages should:

- have stable URLs;
- work without admin controls;
- avoid unnecessary page chrome;
- render predictably at broadcast sizes;
- recover cleanly after refresh;
- represent the same backend state as the public page;
- make stale/disconnected state detectable where practical.

## M5 — Internet publication

For the event-ready deployment:

```text
Local tournament machine
       |
       | publishes/synchronizes state
       v
Internet-accessible RACK HUB service
       |
       +--> public live page
       +--> standings
       +--> bracket
       +--> OBS/browser pages
```

The exact hosting/synchronization technology is deliberately deferred until the local API/state model is stable.

## Manual scoring workflow

BillardPad remains the player-facing source used operationally in the first event. The tournament director manually transfers results into RACK HUB.

RACK HUB should minimize that manual cost with direct score controls on each active match:

```text
Player A                     Player B
[-]   4   [+]                [-]   3   [+]
```

Requirements:

- one-click rack increment;
- one-click rack decrement/correction;
- clear indication of current score;
- deliberate match-finish action;
- no need to navigate through several dialogs for routine rack updates;
- every accepted update should propagate to live/public views.

## FUTURE — Input automation

Possible later work includes BillardPad integration or player-facing result submission.

This is not required for M5 and should not delay a robust manual tournament workflow.
