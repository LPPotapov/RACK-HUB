// RACK HUB PLATFORM — PHASE 2: end-to-end integration using the REAL
// vm2026.js config + REAL normalized historical results +
// seriesScoring.js (section 8/9/10 — "tournament can contribute to
// Prestige + one Rank competition", "14.1 contributes to Prestige
// without Rank", "imported competition-specific contribution wins over
// policy calculation").
//
// No Prestige/Rank FORMULA is registered here (none has been confirmed —
// see the Phase 2 report's terminology map) — these tests prove the
// WIRING between real config and real data resolves correctly, using a
// trivial placeholder policy only where a registered policy is needed to
// prove the plumbing, never presented as the real VM2026 formula.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createImportedContributionRow } from '../src/domain/tournamentResult.js';
import { buildStandingsOnlyTournamentResult } from '../src/series/historicalNormalizers.js';
import {
  VM2026_9BALL_RANK_COMPETITION_ID,
  VM2026_PRESTIGE_COMPETITION_ID,
  VM2026_TOURNAMENT_IDS,
  vm2026Series
} from '../src/series/vm2026.js';
import { resolveTournamentContribution } from '../src/application/seriesScoring.js';

const fixtureRoot = new URL('./fixtures/historical/', import.meta.url);
const load = async (event, file) => JSON.parse(await readFile(new URL(`${event}/${file}`, fixtureRoot), 'utf8'));

const real9BallResult = async () => {
  const metadata = await load('vm-joes-9-ball', 'metadata.json');
  const rows = await load('vm-joes-9-ball', 'expected-final-table.json');
  return buildStandingsOnlyTournamentResult({
    tournamentId: VM2026_TOURNAMENT_IDS.NINE_BALL_1,
    name: metadata.tournamentName,
    date: metadata.date,
    discipline: metadata.discipline,
    rows
  });
};

test('a real tournament (9-Ball Part 1) can contribute to the overall Prestige competition AND the 9-Ball Rank competition independently', async () => {
  const series = vm2026Series();
  const prestige = series.competitions.find((c) => c.id === VM2026_PRESTIGE_COMPETITION_ID);
  const rank9ball = series.competitions.find((c) => c.id === VM2026_9BALL_RANK_COMPETITION_ID);
  const result = await real9BallResult();
  const player = { player: 'Richard Juros' };

  // Trivial placeholder policies — NOT the real, unconfirmed VM2026
  // formula (see the terminology map) — just enough to prove each
  // competition resolves this player's contribution to THIS tournament
  // independently of the other competition.
  const registry = {
    'vm2026-prestige-unconfirmed': (row) => row.prestige,
    'vm2026-rank-unconfirmed': (row) => row.placement
  };

  const prestigeContribution = resolveTournamentContribution(prestige, result, player, registry);
  const rankContribution = resolveTournamentContribution(rank9ball, result, player, registry);

  assert.deepEqual(prestigeContribution, { ok: true, value: 87, source: 'computed' });
  assert.deepEqual(rankContribution, { ok: true, value: 1, source: 'computed' });
});

test('14.1 (vm2026-14-1) is not referenced by any Rank competition, so there is nothing to resolve it against — confirmed at the config level, not just "the policy returned nothing"', () => {
  const series = vm2026Series();
  const rankCompetitionsReferencing14_1 = series.competitions.filter((c) => c.type === 'rank' && c.tournamentIds.includes(VM2026_TOURNAMENT_IDS.FOURTEEN_ONE));
  assert.deepEqual(rankCompetitionsReferencing14_1, []);
});

test('an imported, competition-specific override wins over the registered policy calculation, even when standings exist for that player', async () => {
  const series = vm2026Series();
  const prestige = series.competitions.find((c) => c.id === VM2026_PRESTIGE_COMPETITION_ID);
  const baseResult = await real9BallResult();
  // Simulates a director later correcting ONE player's Prestige
  // contribution with an explicit, audited override — the override must
  // win even though real standings (and therefore a computable value)
  // still exist.
  const resultWithOverride = {
    ...baseResult,
    importedContributions: [createImportedContributionRow({ player: 'Richard Juros', byCompetition: { [VM2026_PRESTIGE_COMPETITION_ID]: 999 } })]
  };

  const registry = { 'vm2026-prestige-unconfirmed': (row) => row.prestige };
  const resolved = resolveTournamentContribution(prestige, resultWithOverride, { player: 'Richard Juros' }, registry);
  assert.deepEqual(resolved, { ok: true, value: 999, source: 'imported' });
});

test('without a registered policy and without an override, a real tournament\'s contribution is reported as unresolved — never guessed — exactly reflecting that no VM2026 formula has been confirmed yet', async () => {
  const series = vm2026Series();
  const prestige = series.competitions.find((c) => c.id === VM2026_PRESTIGE_COMPETITION_ID);
  const result = await real9BallResult();

  const resolved = resolveTournamentContribution(prestige, result, { player: 'Richard Juros' }, {});
  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /no scoring policy registered for method "vm2026-prestige-unconfirmed"/);
});
