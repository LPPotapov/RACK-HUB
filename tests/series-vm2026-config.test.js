// RACK HUB PLATFORM — PHASE 2: the REAL src/series/vm2026.js module
// (section 10 — "VM2026 config contains exactly 7 event slots", "Prestige
// references all 7", "each 8/9/10 Rank references exactly 2", "no 14.1
// Rank competition exists"). series-model.test.js (Phase 1) already
// proved the GENERIC engine can express this shape with an inline
// example; this file proves the ACTUAL shipped vm2026.js module itself is
// correct, including that it's a valid SeriesDefinition.

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSeriesDefinition } from '../src/domain/seriesModel.js';
import {
  VM2026_10BALL_RANK_COMPETITION_ID,
  VM2026_8BALL_RANK_COMPETITION_ID,
  VM2026_9BALL_RANK_COMPETITION_ID,
  VM2026_PRESTIGE_COMPETITION_ID,
  VM2026_TOURNAMENT_IDS,
  vm2026Series
} from '../src/series/vm2026.js';

test('vm2026Series() is a structurally valid SeriesDefinition', () => {
  assert.deepEqual(validateSeriesDefinition(vm2026Series()).errors, []);
});

test('vm2026Series() contains exactly 7 tournament slots', () => {
  const series = vm2026Series();
  assert.equal(series.tournaments.length, 7);
  assert.deepEqual(
    new Set(series.tournaments.map((t) => t.tournamentId)),
    new Set(Object.values(VM2026_TOURNAMENT_IDS))
  );
});

test('the overall Prestige competition references all 7 tournaments, including the 4 placeholder (no-data) slots', () => {
  const series = vm2026Series();
  const prestige = series.competitions.find((c) => c.id === VM2026_PRESTIGE_COMPETITION_ID);
  assert.equal(prestige.type, 'prestige');
  assert.equal(prestige.awardConfig.title, "Master of the Joe's");
  assert.deepEqual(new Set(prestige.tournamentIds), new Set(Object.values(VM2026_TOURNAMENT_IDS)));
});

test('each discipline Rank competition references exactly its own 2 tournaments', () => {
  const series = vm2026Series();
  const byId = Object.fromEntries(series.competitions.map((c) => [c.id, c]));

  assert.deepEqual(byId[VM2026_8BALL_RANK_COMPETITION_ID].tournamentIds, [VM2026_TOURNAMENT_IDS.EIGHT_BALL_1, VM2026_TOURNAMENT_IDS.EIGHT_BALL_2]);
  assert.deepEqual(byId[VM2026_9BALL_RANK_COMPETITION_ID].tournamentIds, [VM2026_TOURNAMENT_IDS.NINE_BALL_1, VM2026_TOURNAMENT_IDS.NINE_BALL_2]);
  assert.deepEqual(byId[VM2026_10BALL_RANK_COMPETITION_ID].tournamentIds, [VM2026_TOURNAMENT_IDS.TEN_BALL_1, VM2026_TOURNAMENT_IDS.TEN_BALL_2]);
  [VM2026_8BALL_RANK_COMPETITION_ID, VM2026_9BALL_RANK_COMPETITION_ID, VM2026_10BALL_RANK_COMPETITION_ID].forEach((id) => {
    assert.equal(byId[id].awardConfig.medalPositions, 3);
  });
});

test('no 14.1 Rank competition exists, and no competition of any kind references the 14.1 tournament except the overall Prestige competition', () => {
  const series = vm2026Series();
  const rankCompetitions = series.competitions.filter((c) => c.type === 'rank');
  assert.equal(rankCompetitions.length, 3, 'exactly 3 Rank competitions (8/9/10-Ball)');
  rankCompetitions.forEach((c) => assert.ok(!c.tournamentIds.includes(VM2026_TOURNAMENT_IDS.FOURTEEN_ONE)));

  const referencing14_1 = series.competitions.filter((c) => c.tournamentIds.includes(VM2026_TOURNAMENT_IDS.FOURTEEN_ONE));
  assert.deepEqual(referencing14_1.map((c) => c.id), [VM2026_PRESTIGE_COMPETITION_ID]);
});

test('the 4 tournaments with no historical data are clearly marked, never given an invented name', () => {
  const series = vm2026Series();
  const placeholderIds = new Set([
    VM2026_TOURNAMENT_IDS.EIGHT_BALL_1,
    VM2026_TOURNAMENT_IDS.EIGHT_BALL_2,
    VM2026_TOURNAMENT_IDS.NINE_BALL_2,
    VM2026_TOURNAMENT_IDS.TEN_BALL_2
  ]);
  series.tournaments
    .filter((t) => placeholderIds.has(t.tournamentId))
    .forEach((t) => assert.match(t.name, /^UNKNOWN/));

  // The 3 real slots use their REAL metadata.json tournament names, never
  // the placeholder marker.
  const realIds = new Set([VM2026_TOURNAMENT_IDS.NINE_BALL_1, VM2026_TOURNAMENT_IDS.TEN_BALL_1, VM2026_TOURNAMENT_IDS.FOURTEEN_ONE]);
  series.tournaments
    .filter((t) => realIds.has(t.tournamentId))
    .forEach((t) => assert.doesNotMatch(t.name, /^UNKNOWN/));
});
