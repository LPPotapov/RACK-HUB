# Architecture Decision Records (ADRs)

This directory records important decisions that future developers and agents should not repeatedly re-litigate without new evidence.

## Format

Each ADR contains:

- **Status** — Proposed, Accepted, Superseded, or Rejected;
- **Context** — why a decision was necessary;
- **Decision** — what the project agreed to do;
- **Consequences** — trade-offs and follow-on effects.

Accepted ADRs remain in the repository even if later superseded. A new ADR should explain the replacement rather than deleting history.

## Current records

- [ADR 0001 — Separate the BBS/domain engine from UI concerns](0001-separate-domain-engine-from-ui.md)
- [ADR 0002 — Backend owns authoritative tournament state](0002-backend-authoritative-state.md)
- [ADR 0003 — Model Canaletto as a reusable multi-stage tournament](0003-multi-stage-tournament-model.md)
- [ADR 0004 — Repository is canonical; AI agents are contributors](0004-repository-and-agent-workflow.md)
