// Frozen (pairing-time) match display values — 2nd director correction pass.
//
// BUG FIXED: match cards previously looked up each player's CURRENT
// recalculated tournament GBR, so a match's displayed GBR/win% would change
// after ANY later result was recorded (including for a completely different
// match), not just its own. That is wrong — a generated matchup must keep
// showing the values that were true WHEN THAT ROUND WAS GENERATED.
//
// FIX: `match.p1.elo`/`match.p2.elo` are ALREADY the pairing-time GBR
// snapshot every match stores (see src/domain/tournamentModel.js's Match
// shape notes: "p1.elo/p2.elo are the pre-match GBR snapshot"), and
// recordMatchResult() is documented and tested to never touch p1/p2 on any
// match (see tournamentCommands.js). So this function stores nothing new —
// it only reads what's already stored, and feeds it through the SAME
// existing expectedScore() formula (fixedRackBbs.js), unmodified.
//
// Pure: no React, no lookup into `tournament.players` (that current/live
// GBR belongs to standings/results, a deliberately different view — see
// src/application/canalettoEvent.js's getBlockStandings()).

import { expectedScore } from '../domain/fixedRackBbs.js';

export const frozenMatchDisplay = (match, config) => ({
  p1Gbr: match.p1.elo,
  p2Gbr: match.p2.elo,
  p1WinPct: expectedScore(match.p1.elo, match.p2.elo, config.d) * 100,
  p2WinPct: expectedScore(match.p2.elo, match.p1.elo, config.d) * 100
});
