import assert from 'node:assert/strict';
import test from 'node:test';
import { captureApplicationStateFromLegacy, projectApplicationStateToLegacy } from '../src/application/legacyStateAdapter.js';
import { recordMatchResult, startTournament } from '../src/application/tournamentCommands.js';
import { recalculateTournamentPlayers } from '../src/domain/tournamentRecalculation.js';

// M3 — PoolTournamentApp.jsx's recalc() useEffect (fires on every allRounds/
// currentRound change) now delegates directly to recalculateTournamentPlayers()
// instead of duplicating the calculation inline. Every wired command
// (recordMatchResult()/advanceTournamentRound()) already calls this same
// function internally before returning its projected legacy state, so the
// effect necessarily re-runs it a SECOND time on the same rounds/
// currentRound/config/roster whenever a wired handler commits new state.
// This test proves that second, effect-triggered pass is a true no-op
// (idempotent) and, specifically, does NOT reintroduce the old legacy
// games+1 bye behavior — the exact "duplicate authority" conflict the M3
// wiring task called out.
const baseConfig = () => ({
  d: 330, k_m: 30, k_r: 20, max_games: 6, default_rounds: 2,
  use_rp: true, rp_per_round: 10, rp_per_mp: 10, rp_elo_multiplier: 0.15,
  ranking_system: 'classic', use_rank: false, format: 'fixed_rack',
  straightPool: {
    enabled: false, label: 'GBR_14.1 Experimental', startTarget: 40, tieringStartsRound: 2,
    tierTargets: [50, 40, 30], targetReference: 40, useTargetScaledK: true, k_14_1: 20,
    marginWeight: 0.60, bpiWeight: 0.30, highRunWeight: 0.10, standingsOrder: 'mp_perf_npd'
  }
});

test("re-running recalculateTournamentPlayers() after a wired command (simulating PoolTournamentApp.jsx's recalc() effect) is idempotent, including for a bye", () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Odd Club Night', ...config };
  const roster = [
    { id: 1, name: 'Alpha', elo: 1600 },
    { id: 2, name: 'Bravo', elo: 1500 },
    { id: 3, name: 'Charlie', elo: 1550 } // odd count -> Round 1 has a bye
  ];

  let canonical = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament: null, players: roster, pendingPlayers: [], allRounds: {}, currentRound: 0
  });
  canonical = startTournament(canonical, { seedMethod: 'random' });

  const byeMatch = canonical.tournament.rounds[1].find((m) => m.bye);
  assert.ok(byeMatch, 'fixture must produce a bye in Round 1');
  const realMatch = canonical.tournament.rounds[1].find((m) => !m.bye);

  canonical = recordMatchResult(canonical, { roundNumber: 1, matchId: realMatch.id, r1: 4, r2: 2 });

  // ---- Simulate exactly what PoolTournamentApp.jsx now does: project the
  // wired command's result into legacy state (recalculation already applied
  // once, inside recordMatchResult), then re-run recalculateTournamentPlayers()
  // a second time the way the recalc() effect will (triggered by the same
  // allRounds/currentRound change). ----
  const legacy = projectApplicationStateToLegacy(canonical);
  const firstPass = legacy.tournament.players;

  const secondPass = recalculateTournamentPlayers({
    players: legacy.tournament.players,
    roster: legacy.players,
    rounds: legacy.allRounds,
    currentRound: legacy.currentRound,
    config: legacy.config
  });

  assert.deepEqual(secondPass, firstPass, 'a second recalculation pass over the same history must be a true no-op');

  const byePlayerAfter = secondPass.find((p) => p.id === byeMatch.p1.id);
  assert.equal(byePlayerAfter.mp, 1); // +1 MP for the bye
  assert.equal(byePlayerAfter.games, 0); // NOT incremented by the second pass either — authoritative bye rule, not legacy's old games+1
});
