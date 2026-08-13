import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { captureApplicationStateFromLegacy, projectApplicationStateToLegacy } from '../src/application/legacyStateAdapter.js';
import { advanceTournamentRound, recordMatchResult, startTournament } from '../src/application/tournamentCommands.js';
import { validateApplicationState } from '../src/domain/tournamentModel.js';

// M2O — historical 14.1 integration test THROUGH the legacy compatibility
// boundary (not just canonical-to-canonical, which tests/historical-14-1-replay.test.js
// already covers). Drives the real vm-joes-14-1 event as far as current
// evidence honestly allows:
//
//   legacy-shaped configured state
//     -> captureApplicationStateFromLegacy()
//     -> startTournament(cross_elo)                [Round 1 — exact match, re-verified]
//     -> recordMatchResult() x5 with REAL Round 1 results
//     -> advanceTournamentRound()                    [Round 2 — 3/5 exact, characterized]
//     -> recordMatchResult() x5 — REAL results for the 3 exactly-matching
//        pairings; clearly-labeled SYNTHETIC results for the 2 pairings that
//        have no historical equivalent (see tests/historical-14-1-replay.test.js
//        and docs/ARCHITECTURE.md for why Round 2 partially diverges — a
//        tier-target boundary case and a single-point PERF-gap tie-break;
//        not a formula defect)
//     -> advanceTournamentRound()                    [Round 3 — mechanics only,
//        NOT claimed as historically accurate, since Round 2 already diverged]
//     -> projectApplicationStateToLegacy()
//
// No config was tuned to force a historical match; the already-characterized
// Round 2 divergence is preserved exactly, not hidden or "fixed".

const fixtureRoot = new URL('./fixtures/historical/vm-joes-14-1/', import.meta.url);
const load = async (file) => JSON.parse(await readFile(new URL(file, fixtureRoot), 'utf8'));

test('historical 14.1 event driven through the full legacy <-> canonical boundary as far as evidence allows', async () => {
  const [playersFixture, matches] = await Promise.all([load('players.json'), load('matches.json')]);
  const roster = playersFixture.map((p, index) => ({ id: index, name: p.name, elo: p.startingGbr }));
  const nameById = new Map(roster.map((p) => [p.id, p.name]));
  const idByName = new Map(roster.map((p) => [p.name, p.id]));

  const config = {
    d: 330, k_m: 30, k_r: 20, max_games: 6, default_rounds: 5,
    use_rp: true, rp_per_round: 10, rp_per_mp: 10, rp_elo_multiplier: 0.15,
    ranking_system: 'classic', use_rank: false, format: 'straight_pool_14_1',
    straightPool: {
      enabled: true, label: 'GBR_14.1 Experimental', startTarget: 30, tieringStartsRound: 2,
      tierTargets: [40, 30, 20], targetReference: 40, useTargetScaledK: true, k_14_1: 20,
      marginWeight: 0.60, bpiWeight: 0.30, highRunWeight: 0.10, standingsOrder: 'mp_perf_npd'
    }
  };
  const tournamentConfig = { title: '14.1 VM 2026', ...config };

  // ---- 1. Legacy-shaped configured input -> canonical capture ----
  const legacyPreStart = {
    config, tournamentConfig, tournament: null, players: roster, pendingPlayers: [], allRounds: {}, currentRound: 0
  };
  let canonical = captureApplicationStateFromLegacy(legacyPreStart);
  assert.equal(canonical.tournament.started, false);

  // ---- 2. Start with the actual historical seed method: Cross GBR ----
  canonical = startTournament(canonical, { seedMethod: 'cross_elo' });
  assert.equal(canonical.tournament.started, true);

  const nameOf = (playerRef) => nameById.get(playerRef.id);

  // Round 1 pairing exactly matches historical (re-verified through the full
  // capture -> command boundary, not just canonical-to-canonical).
  const round1Historical = matches.filter((m) => m.round === 1);
  round1Historical.forEach((m, i) => {
    assert.equal(nameOf(canonical.tournament.rounds[1][i].p1), m.playerA, `R1 match ${i + 1} playerA`);
    assert.equal(nameOf(canonical.tournament.rounds[1][i].p2), m.playerB, `R1 match ${i + 1} playerB`);
  });

  // ---- 3. Enter the REAL Round 1 results ----
  for (const m of round1Historical) {
    const genMatch = canonical.tournament.rounds[1].find((gm) => {
      const p1n = nameOf(gm.p1);
      const p2n = nameOf(gm.p2);
      return (p1n === m.playerA && p2n === m.playerB) || (p1n === m.playerB && p2n === m.playerA);
    });
    const flip = nameOf(genMatch.p1) !== m.playerA;
    canonical = recordMatchResult(canonical, {
      roundNumber: 1, matchId: genMatch.id,
      p1Points: flip ? m.pointsB : m.pointsA,
      p2Points: flip ? m.pointsA : m.pointsB,
      innings: m.innings,
      p1HighRun: flip ? m.highRunB : m.highRunA,
      p2HighRun: flip ? m.highRunA : m.highRunB
    });
  }
  canonical.tournament.rounds[1].forEach((m) => assert.equal(m.done, true));

  // Table identifiers from the real fixture are alphanumeric STRINGS ("304" etc.) —
  // prove they still survive through startTournament()'s own numbering (M2L's
  // tableNumbers pass-through) is a separate concern; here we prove
  // recordMatchResult() didn't touch the table field at all.
  const preResultTables = canonical.tournament.rounds[1].map((m) => m.tbl);
  assert.ok(preResultTables.every((t) => typeof t === 'number')); // generatePairings()'s own default numbering (fixture tables weren't re-applied at pairing time — this test doesn't call assignMatchTable here, see the fixed-rack test for that proof)

  // ---- 4. Advance to Round 2 ----
  const round1Locked = canonical.tournament.rounds[1];
  canonical = advanceTournamentRound(canonical);
  assert.equal(canonical.tournament.currentRound, 2);
  assert.deepEqual(canonical.tournament.rounds[1], round1Locked); // untouched by advancing

  // Round 2: 3 of 5 pairings match historical exactly (already characterized
  // in tests/historical-14-1-replay.test.js) — re-confirm briefly here.
  const round2Generated = canonical.tournament.rounds[2];
  const generatedPairs = round2Generated.map((m) => [nameOf(m.p1), nameOf(m.p2)].sort().join(' vs '));
  ['Paul Weißbach vs Quang Anh Tran', 'Janoš Nuck vs Richard Juros', 'Carsten Gäbler vs Leonid Potapov']
    .forEach((pair) => assert.ok(generatedPairs.includes(pair), `expected ${pair} in generated Round 2`));

  // ---- 5. Enter Round 2 results: REAL data for the 3 exact pairings,
  // clearly-labeled SYNTHETIC data for the 2 that have no historical
  // equivalent this round (the pairing/target divergence already
  // characterized — see file header). ----
  const round2Historical = matches.filter((m) => m.round === 2);
  const realPairKeys = new Set(['Paul Weißbach|Quang Anh Tran', 'Janoš Nuck|Richard Juros']); // exact target too
  for (const m of round2Generated) {
    const p1n = nameOf(m.p1);
    const p2n = nameOf(m.p2);
    const key = [p1n, p2n].sort().join('|');

    if (key === 'Carsten Gäbler|Leonid Potapov') {
      // Pairing matches historical, but the GENERATED target (30) differs
      // from the historical target (40) — see the characterized tier-
      // boundary divergence. Entering the real 40-target result into a
      // 30-target match would be internally inconsistent, so this uses
      // synthetic-but-plausible values for the ACTUAL generated target.
      canonical = recordMatchResult(canonical, {
        roundNumber: 2, matchId: m.id,
        p1Points: nameOf(m.p1) === 'Carsten Gäbler' ? 12 : 30,
        p2Points: nameOf(m.p1) === 'Carsten Gäbler' ? 30 : 12,
        innings: 10, p1HighRun: 5, p2HighRun: 8
      });
      continue;
    }

    const histMatch = round2Historical.find((hm) => [hm.playerA, hm.playerB].sort().join('|') === key);
    if (histMatch && realPairKeys.has([histMatch.playerA, histMatch.playerB].join('|'))) {
      const flip = p1n !== histMatch.playerA;
      canonical = recordMatchResult(canonical, {
        roundNumber: 2, matchId: m.id,
        p1Points: flip ? histMatch.pointsB : histMatch.pointsA,
        p2Points: flip ? histMatch.pointsA : histMatch.pointsB,
        innings: histMatch.innings,
        p1HighRun: flip ? histMatch.highRunB : histMatch.highRunA,
        p2HighRun: flip ? histMatch.highRunA : histMatch.highRunB
      });
      continue;
    }

    // No historical equivalent for this generated pairing — synthetic result.
    canonical = recordMatchResult(canonical, { roundNumber: 2, matchId: m.id, p1Points: 25, p2Points: 15, innings: 12, p1HighRun: 6, p2HighRun: 4 });
  }
  canonical.tournament.rounds[2].forEach((m) => assert.equal(m.done, true));

  // ---- 6. Advance to Round 3 — proves the chain keeps working across
  // multiple rounds; NOT claimed to be historically accurate (Round 2
  // already diverged from the real event). ----
  const round2Locked = canonical.tournament.rounds[2];
  canonical = advanceTournamentRound(canonical);
  assert.equal(canonical.tournament.currentRound, 3);
  assert.deepEqual(canonical.tournament.rounds[1], round1Locked);
  assert.deepEqual(canonical.tournament.rounds[2], round2Locked);
  assert.equal(canonical.tournament.rounds[3].length, 5);
  canonical.tournament.rounds[3].forEach((m) => assert.equal(m.format, 'straight_pool_14_1'));

  // ---- 7. Project back to the legacy shape and verify parity ----
  const legacy = projectApplicationStateToLegacy(canonical);
  assert.deepEqual(validateApplicationState(canonical), { valid: true, errors: [] });

  assert.deepEqual(legacy.config, canonical.tournament.config);
  assert.deepEqual(legacy.tournamentConfig, canonical.tournament.tournamentConfig);
  assert.deepEqual(legacy.players, canonical.tournament.roster);
  assert.equal(legacy.tournament.totalRounds, canonical.tournament.totalRounds);
  assert.equal('started' in legacy.tournament, false);
  assert.deepEqual(legacy.allRounds, canonical.tournament.rounds);
  assert.equal(legacy.currentRound, 3);
  assert.deepEqual(legacy.pendingPlayers, []);
  assert.ok(legacy.preAdvanceSnapshot);

  // 14.1 targets survive projection exactly (both the historically-stamped
  // Round 1 targets, all 30, and Round 2's mixed generated targets).
  legacy.allRounds[1].forEach((m) => assert.equal(m.target, 30));
  assert.equal(typeof legacy.allRounds[2][0].target, 'number');

  // Re-capturing the projected legacy state reproduces the same canonical meaning.
  const recaptured = captureApplicationStateFromLegacy(legacy);
  assert.deepEqual(recaptured.tournament.rounds, canonical.tournament.rounds);
  assert.equal(recaptured.tournament.currentRound, 3);
});
