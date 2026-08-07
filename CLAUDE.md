# Claude Code Instructions — RACK HUB

Read and follow `AGENTS.md`. It contains the canonical project-wide development rules.

This file adds Claude-specific operating rules.

## Context and subscription efficiency

The project owner has limited Claude Code subscription usage. Work economically with context.

- Read only files relevant to the current task after initial orientation.
- Do not repeatedly reread the large legacy source or whitepaper without a concrete reason.
- Prefer targeted search over loading entire large files.
- Do not perform speculative repository-wide analysis after the task is understood.
- Keep implementation reports concise.
- Stop when the requested task is complete.
- Do not start a follow-on refactor or improvement automatically.

For unrelated tasks, recommend starting a fresh Claude context with `/clear` when appropriate.

Claude cannot safely infer the owner's remaining subscription quota from the codebase. At the end of a meaningful task, include a short reminder:

> Usage check: run `/usage` in Claude Code.

If Claude Code exposes reliable session/context usage information directly, report it. Never invent remaining quota or token numbers.

## High-risk BBS changes

Treat changes to GBR, PERF, pairing, byes, standings, tournament progression, or historical-data migration as high risk.

For such tasks:

1. inspect the relevant specification and tests first;
2. make the smallest possible change;
3. run the regression suite;
4. call out any behavior difference explicitly;
5. recommend independent review by a second agent (for example Codex) before merge.

## Commits and pushes

Do not commit or push unless explicitly instructed by the project owner.
