# Deployment

## Purpose

Deployment evolves in stages. RACK HUB should not lock its domain logic to a hosting provider before the local architecture and API are stable.

## CURRENT — M0/M1

Development is local only.

The immediate requirement is a reproducible local development/build environment. Production hosting is not part of M0 or M1.

## TARGET — M2/M3 local architecture

Frontend and backend run locally but communicate through the same explicit contract intended for later deployment.

The exact ports and process manager should be documented once implemented rather than guessed here.

A likely local topology is:

```text
Browser / OBS
      |
      v
Frontend
      |
      v
Local backend/API
      |
      v
Durable local tournament state
```

## TARGET — M5 event-ready topology

For the first real tournament, the intended operating model is:

```text
Tournament director machine
  - local admin UI
  - local tournament control
         |
         | internet publication/synchronization
         v
Public RACK HUB service
  - live scores
  - standings
  - bracket
  - browser/OBS views
```

The operator should be able to continue controlling/recovering the tournament even if public connectivity becomes temporarily unreliable.

## Hosting decision

No production backend stack is considered final yet.

Existing IONOS infrastructure is a likely deployment target, but the implementation choice should be made only after the M2 backend/API shape is known and the actual hosting capabilities are confirmed.

The architecture must avoid coupling the BBS/domain engine to IONOS, a particular database, or a specific server runtime.

## Data protection and recovery

By M5, deployment documentation must include tested procedures for:

- backing up authoritative tournament state;
- restoring that state on the tournament machine;
- exporting completed tournament results;
- preserving rating/history data required for later import;
- recovering public publication after connectivity/service interruption.

Recommended event practice should eventually include backups before the event, during major stage transitions, and after completion.

## Security

Before public deployment:

- public endpoints must not expose administrative mutation controls without protection;
- secrets/credentials must never be committed to Git;
- environment-specific configuration should be externalized;
- administrative access must be deliberately scoped.

Specific authentication technology is FUTURE until the deployed architecture requires it.

## FUTURE — Permanent platform

M6+ introduces persistent tournament archives and player/rating history. At that point production deployment will require durable database storage, migration/backup strategy, and long-lived public URLs.
