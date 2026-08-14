// KO GBR characterization (docs task item 9): proves the EXISTING, UNCHANGED
// fixedRackBbs.gbrChange(gbrA, gbrB, racksA, racksB, {d,k_m,k_r}) can be fed a
// race-to result's actual played rack counts directly — no scaling, no new
// denominator, no new K value — and produces sane, representative results
// for race-to-7 and race-to-9 (Final) at equal and unequal starting GBR.
//
// See src/application/canalettoKo.js's header comment for the full mapping
// rationale. This file exists to make the resulting numbers visible and
// regression-tested, not just asserted abstractly.

import assert from 'node:assert/strict';
import test from 'node:test';
import { gbrChange } from '../src/domain/fixedRackBbs.js';
import { createKoStage, recordKoMatchResult } from '../src/application/canalettoKo.js';

const GBR_CONFIG = { d: 330, k_m: 30, k_r: 20 };
// This file characterizes the RAW (unweighted) BBS formula mapping — the KO
// GBR weighting applied on top of it is a separate, later application-layer
// step (see canaletto-ko-gbr-weight.test.js). Weight 1 means
// appliedDelta === rawDelta here, so every existing assertion below still
// reads as "the raw BBS change", unchanged from before that weighting was
// introduced.
const NO_WEIGHT = 1;

const seed = (label, playerId, name, gbr) => ({ seed: label, playerId, name, gbr });

// GBR_INTEGER_RULE (see canalettoKo.js) rounds appliedDelta/postGbr to
// whole integers — deriving p1Change from (postGbr - gbrA) would therefore
// introduce up to 0.5 of rounding noise into what this file characterizes.
// Reading `m.rawDelta` directly instead gives the exact, FULL-PRECISION raw
// BBS change this file is actually about — rawDelta is deliberately never
// rounded internally (only its rounded-and-weighted derivative is), so this
// remains a true characterization of the unmodified formula.
const assertCloseTo = (actual, expected) => assert.ok(
  Math.abs(actual - expected) < 1e-6,
  `expected ${actual} to be close to ${expected}`
);

const play = (gbrA, gbrB, r1, r2, target) => {
  const stage = createKoStage(
    [{ matchNumber: 1, top: seed('A1', 1, 'P1', gbrA), bottom: seed('A2', 2, 'P2', gbrB) }],
    []
  );
  const after = recordKoMatchResult(stage, { matchNumber: 1, r1, r2 }, target, GBR_CONFIG, NO_WEIGHT);
  const m = after.matches[0];
  return { p1Change: m.rawDelta, p2Change: -m.rawDelta };
};

// -----------------------------------------------------------------------
// Race-to-7 — equal opponents (1800 vs 1800)
// -----------------------------------------------------------------------

test('race-to-7, equal GBR (1800 v 1800): 7-0 change matches gbrChange(1800,1800,7,0,config) exactly', () => {
  const { p1Change } = play(1800, 1800, 7, 0, 7);
  assertCloseTo(p1Change, gbrChange(1800, 1800, 7, 0, GBR_CONFIG));
});

test('race-to-7, equal GBR: a bigger margin produces a bigger winner GBR gain (7-0 > 7-3 > 7-6)', () => {
  const win70 = play(1800, 1800, 7, 0, 7).p1Change;
  const win73 = play(1800, 1800, 7, 3, 7).p1Change;
  const win76 = play(1800, 1800, 7, 6, 7).p1Change;
  assert.ok(win70 > win73 && win73 > win76, `expected 7-0 (${win70}) > 7-3 (${win73}) > 7-6 (${win76})`);
});

test('race-to-7, equal GBR: change is exactly zero-sum (winner gain == loser loss)', () => {
  const { p1Change, p2Change } = play(1800, 1800, 7, 3, 7);
  assert.equal(p1Change, -p2Change);
});

// -----------------------------------------------------------------------
// Race-to-7 — unequal opponents (favorite 1800 v underdog 1600)
// -----------------------------------------------------------------------

test('race-to-7, unequal GBR (1800 favorite v 1600 underdog): underdog winning 7-6 gains more than favorite winning 7-6', () => {
  const favoriteWins = play(1800, 1600, 7, 6, 7).p1Change; // favorite (p1) wins narrowly
  const underdogWins = play(1600, 1800, 7, 6, 7).p1Change; // underdog (p1) wins narrowly (gbrA/gbrB swapped)
  assert.ok(underdogWins > favoriteWins, `expected underdog gain (${underdogWins}) > favorite gain (${favoriteWins})`);
});

test('race-to-7, unequal GBR: every recorded change equals the independent gbrChange() call with the same r1/r2', () => {
  [[7, 0], [7, 3], [7, 6]].forEach(([r1, r2]) => {
    const { p1Change } = play(1800, 1600, r1, r2, 7);
    assertCloseTo(p1Change, gbrChange(1800, 1600, r1, r2, GBR_CONFIG));
  });
});

// -----------------------------------------------------------------------
// Race-to-9 (Final) — equal and unequal opponents
// -----------------------------------------------------------------------

test('race-to-9 (Final), equal GBR: 9-0/9-4/9-8 changes match gbrChange() exactly, decreasing with a closer margin', () => {
  const results = [[9, 0], [9, 4], [9, 8]].map(([r1, r2]) => {
    const { p1Change } = play(1800, 1800, r1, r2, 9);
    assertCloseTo(p1Change, gbrChange(1800, 1800, r1, r2, GBR_CONFIG));
    return p1Change;
  });
  assert.ok(results[0] > results[1] && results[1] > results[2], `expected strictly decreasing gains: ${results}`);
});

test('race-to-9 (Final), unequal GBR (1800 v 1600): changes match gbrChange() exactly', () => {
  [[9, 0], [9, 4], [9, 8]].forEach(([r1, r2]) => {
    const { p1Change } = play(1800, 1600, r1, r2, 9);
    assertCloseTo(p1Change, gbrChange(1800, 1600, r1, r2, GBR_CONFIG));
  });
});

// -----------------------------------------------------------------------
// Representative table, printed for the record (not asserted beyond the
// exact-formula-match assertions above).
// -----------------------------------------------------------------------

test('representative race-to GBR characterization table', () => {
  const rows = [];
  [
    ['race-to-7 equal (1800v1800)', 1800, 1800, 7, [[7, 0], [7, 3], [7, 6]]],
    ['race-to-7 unequal (1800fav v1600dog)', 1800, 1600, 7, [[7, 0], [7, 3], [7, 6]]],
    ['race-to-9 equal (1800v1800)', 1800, 1800, 9, [[9, 0], [9, 4], [9, 8]]],
    ['race-to-9 unequal (1800fav v1600dog)', 1800, 1600, 9, [[9, 0], [9, 4], [9, 8]]]
  ].forEach(([label, gbrA, gbrB, target, scores]) => {
    scores.forEach(([r1, r2]) => {
      const { p1Change, p2Change } = play(gbrA, gbrB, r1, r2, target);
      rows.push({ label, score: `${r1}-${r2}`, p1Change: p1Change.toFixed(2), p2Change: p2Change.toFixed(2) });
    });
  });
  console.log('\nKO GBR characterization (winner change / loser change):');
  rows.forEach((r) => console.log(`  ${r.label.padEnd(38)} ${r.score.padEnd(6)} ${r.p1Change} / ${r.p2Change}`));
  assert.ok(rows.length === 12);
});
