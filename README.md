# RACK HUB

RACK HUB is tournament-management and live-publishing software for cue-sports events.

It is deliberately separate from the **Batforce Billiards System (BBS)**:

- **BBS** defines tournament/rating methodology such as fixed-rack Swiss-style operation, GBR, PERF, pairing, bye handling, and standings rules.
- **RACK HUB** is the software platform that implements BBS, runs tournaments, publishes live information, and can later support additional tournament formats.

## Project status

**CURRENT milestone:** M0 — Project Foundation  
**Status:** IN PROGRESS

Current objective: move the legacy browser application into a conventional, version-controlled React/Vite project **without changing tournament behavior**.

The next milestone is M1 — BBS Baseline Reproduction, where a completed historical tournament will be replayed and its final standings reproduced as a regression baseline.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full milestone plan.

## Documentation map

- [Vision](docs/VISION.md) — what RACK HUB is intended to become.
- [Roadmap](docs/ROADMAP.md) — milestones, scope, and acceptance criteria.
- [Architecture](docs/ARCHITECTURE.md) — current state, target boundaries, and design constraints.
- [BBS](docs/BBS.md) — relationship between RACK HUB, the BBS whitepaper, and the legacy implementation.
- [Testing](docs/TESTING.md) — regression strategy and reference-tournament acceptance rules.
- [Live](docs/LIVE.md) — live pages, overlays, and publication flow.
- [Tournament formats](docs/TOURNAMENT-FORMATS.md) — BBS and multi-stage tournament model.
- [Deployment](docs/DEPLOYMENT.md) — local-first deployment path and event-ready target.
- [Architecture decisions](docs/decisions/README.md) — accepted decisions that agents and developers must not silently revisit.

## Source-of-truth labels

Project documentation uses these labels:

- **CURRENT** — implemented and verified now.
- **TARGET** — agreed direction for an upcoming milestone.
- **FUTURE** — possible later work; not a current commitment.

Documentation must never describe TARGET or FUTURE behavior as already implemented.

## Local development

**CURRENT:** M0 setup is still in progress. The canonical local commands will be documented here once the Vite migration is verified.

The intended M0 end state is:

```bash
npm install
npm run dev
npm run build
```

## Working rules

Read `AGENTS.md` before making changes. Claude Code must also read `CLAUDE.md`.

The repository is authoritative. AI agents are temporary contributors to the same codebase; they are not separate implementations of RACK HUB.
