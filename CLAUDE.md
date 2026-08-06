# RACK HUB Development Rules

RACK HUB is tournament-management software.

The Batforce Billiards System (BBS) is the tournament and rating
methodology implemented by RACK HUB. We will call it "BBS Engine"

## Sources of truth

The repository contains:
- the BBS whitepaper
- the legacy tournament application

The legacy application is a reference implementation and must not
be modified.

## Rules

Do not change GBR mathematics unless explicitly requested.

Do not change PERF mathematics unless explicitly requested.

Do not change pairing, bye, or standings behavior unless explicitly
requested.

14.1 behavior is experimental and must remain isolated from stable
fixed-rack BBS behavior.

Do not silently improve or simplify formulas.

Domain calculations must eventually be separated from React UI code.

Prefer small incremental changes over broad rewrites.

Do not modify unrelated files.

Before completing work, run:

npm run build

Do not commit or push unless explicitly requested.