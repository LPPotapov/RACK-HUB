// Frozen (pairing-time) KO match display values — the KO equivalent of
// matchDisplay.js's frozenMatchDisplay(), for KoMatch (canalettoKo.js)
// instead of the canonical fixed-rack Match. A KoMatch's `p1.gbr`/`p2.gbr`
// ARE ALREADY the pre-match GBR snapshot (frozen at stage-generation time —
// see canalettoKo.js's createKoStageMatches()/winnerSlot()), and
// recordKoMatchResult() never touches them, only `p1PostGbr`/`p2PostGbr`. So
// this reads what's already stored, unmodified, through the same existing
// expectedScore() formula.

import { expectedScore } from '../domain/fixedRackBbs.js';

export const koFrozenMatchDisplay = (match, config) => ({
  p1Gbr: match.p1.gbr,
  p2Gbr: match.p2.gbr,
  p1WinPct: expectedScore(match.p1.gbr, match.p2.gbr, config.d) * 100,
  p2WinPct: expectedScore(match.p2.gbr, match.p1.gbr, config.d) * 100
});
