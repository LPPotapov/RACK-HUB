import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STRAIGHT_POOL_DEFAULTS,
  assignStraightPoolTierTargets,
  calcNPD,
  calcStraightPoolGbrChange,
  calcStraightPoolPerf,
  calcStraightPoolSignals,
  clamp01,
  compareStraightPool,
  getSP,
  getStraightPoolTargetForMatch,
  isStraightPool,
  normalizeWeights
} from '../src/domain/straightPool14_1.js';

const d = 330, k_m = 30;
const closeTo = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const player = (overrides = {}) => ({ id: 0, mp: 0, perf: 0, perfCount: 0, pointsFor: 0, pointsAgainst: 0, inningsTotal: 0, hs: 0, ...overrides });

// ---------------------------------------------------------------------------
// 1. Signal construction
// ---------------------------------------------------------------------------

test('signals: symmetric/equal case yields 0.5 across the board', () => {
  const sig = calcStraightPoolSignals(20, 20, 10, 5, 5, 40, STRAIGHT_POOL_DEFAULTS);
  assert.equal(sig.sMatch, 0.5);
  assert.equal(sig.sMargin, 0.5);
  assert.equal(sig.sBpi, 0.5);
  assert.equal(sig.sHr, 0.5);
  // weighted sum of three 0.5 terms; not bit-exact due to float summation order
  closeTo(sig.s141, 0.5);
});

test('signals: player A advantage (30-16 in 9 innings, HR 9 vs 4, target 30)', () => {
  const sig = calcStraightPoolSignals(30, 16, 9, 9, 4, 30, STRAIGHT_POOL_DEFAULTS);
  assert.equal(sig.sMatch, 1);
  closeTo(sig.sMargin, 0.7333333333333334);
  closeTo(sig.sBpi, 0.6521739130434784);
  closeTo(sig.sHr, 0.6923076923076923);
  closeTo(sig.s141, 0.7048829431438127);
});

test('signals: player B advantage is the exact mirror of player A advantage', () => {
  const sig = calcStraightPoolSignals(16, 30, 9, 4, 9, 30, STRAIGHT_POOL_DEFAULTS);
  assert.equal(sig.sMatch, 0);
  closeTo(sig.sMargin, 0.26666666666666666);
  closeTo(sig.sBpi, 0.34782608695652173);
  closeTo(sig.sHr, 0.3076923076923077);
  closeTo(sig.s141, 0.2951170568561873);
});

test('signals: zero innings falls back sBpi to 0.5 rather than dividing by zero', () => {
  const sig = calcStraightPoolSignals(10, 5, 0, 3, 1, 40, STRAIGHT_POOL_DEFAULTS);
  assert.equal(sig.sBpi, 0.5);
});

test('signals: zero high-run totals on both sides falls back sHr to 0.5', () => {
  const sig = calcStraightPoolSignals(10, 5, 10, 0, 0, 40, STRAIGHT_POOL_DEFAULTS);
  assert.equal(sig.sHr, 0.5);
});

test('signals: non-positive target normalizes to T=1 (large margin swing per point)', () => {
  const sig = calcStraightPoolSignals(1, 0, 5, 0, 0, 0, STRAIGHT_POOL_DEFAULTS);
  // T falls back to 1: sMargin = clamp01(0.5 + (1-0)/2) = clamp01(1.0) = 1 (clamped)
  assert.equal(sig.sMargin, 1);
});

test('signals: missing weights object normalizes to the 0.60/0.30/0.10 defaults', () => {
  const withDefaults = calcStraightPoolSignals(20, 10, 10, 5, 2, 40, undefined);
  const withExplicitDefaults = calcStraightPoolSignals(20, 10, 10, 5, 2, 40, { marginWeight: 0.60, bpiWeight: 0.30, highRunWeight: 0.10 });
  // Missing weights take the sum<=0 short-circuit (exact literal defaults); explicit
  // 0.60/0.30/0.10 weights go through the m/sum division instead, which is not
  // bit-identical (0.6+0.3+0.1 !== 1 exactly in IEEE 754) — both are "current defaults",
  // just reached via different floating-point paths, hence the epsilon here.
  assert.equal(withDefaults.sMatch, withExplicitDefaults.sMatch);
  assert.equal(withDefaults.sMargin, withExplicitDefaults.sMargin);
  assert.equal(withDefaults.sBpi, withExplicitDefaults.sBpi);
  assert.equal(withDefaults.sHr, withExplicitDefaults.sHr);
  closeTo(withDefaults.s141, withExplicitDefaults.s141);
});

test('signals: non-normalized supplied weights (3/1/1) are normalized to sum to 1', () => {
  const w = normalizeWeights({ marginWeight: 3, bpiWeight: 1, highRunWeight: 1 });
  closeTo(w.marginWeight, 0.6);
  closeTo(w.bpiWeight, 0.2);
  closeTo(w.highRunWeight, 0.2);
});

test('normalizeWeights: all-zero weights fall back to defaults (sum <= 0 branch)', () => {
  assert.deepEqual(normalizeWeights({ marginWeight: 0, bpiWeight: 0, highRunWeight: 0 }), { marginWeight: 0.60, bpiWeight: 0.30, highRunWeight: 0.10 });
});

test('clamp01 saturates outside [0, 1]', () => {
  assert.equal(clamp01(-0.2), 0);
  assert.equal(clamp01(1.4), 1);
  assert.equal(clamp01(0.37), 0.37);
});

// ---------------------------------------------------------------------------
// 2. 14.1 PERF
// ---------------------------------------------------------------------------

test('14.1 PERF: ordinary inverse-logistic result, rounded', () => {
  // s141 = 0.7048829431438127 (from the A-advantage signal case above), opponent GBR 1657
  assert.equal(calcStraightPoolPerf(1657, 0.7048829431438127, 330), 1782);
});

test('14.1 PERF: s141 exactly 0.5 returns the opponent GBR unchanged (log10(1) = 0)', () => {
  assert.equal(calcStraightPoolPerf(1600, 0.5, 330), 1600);
});

test('14.1 PERF: upper cap at s141 >= 0.999 is opponent + 3d', () => {
  assert.equal(calcStraightPoolPerf(1700, 0.999, 330), 1700 + 3 * 330);
  assert.equal(calcStraightPoolPerf(1700, 1, 330), 1700 + 3 * 330);
});

test('14.1 PERF: lower cap at s141 <= 0.001 is opponent - 3d', () => {
  assert.equal(calcStraightPoolPerf(1700, 0.001, 330), 1700 - 3 * 330);
  assert.equal(calcStraightPoolPerf(1700, 0, 330), 1700 - 3 * 330);
});

test('14.1 PERF: opponent GBR shifts the result by exactly its own delta at fixed s141', () => {
  const s141 = 0.65;
  const perfLow = calcStraightPoolPerf(1500, s141, 330);
  const perfHigh = calcStraightPoolPerf(1600, s141, 330);
  assert.equal(perfHigh - perfLow, 100);
});

// ---------------------------------------------------------------------------
// 3. 14.1 GBR change
// ---------------------------------------------------------------------------

test('GBR change: equal-GBR baseline splits match + signal contribution (target-scaled K, default sp)', () => {
  const sp = STRAIGHT_POOL_DEFAULTS; // useTargetScaledK: true, k_14_1: 20, targetReference: 40
  const change = calcStraightPoolGbrChange(1600, 1600, {
    p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4, target: 30
  }, { d, k_m, sp });
  // eA = 0.5 (equal GBR); dMatch = 30*(1-0.5) = 15
  // kEff = 20*sqrt(30/40) = 17.320508075688775; d141 = kEff*(0.7048829431438127-0.5)
  closeTo(change, 18.548676671293293);
});

test('GBR change: useTargetScaledK=false uses the flat k_14_1 (no sqrt(target/targetReference) scaling)', () => {
  const sp = { ...STRAIGHT_POOL_DEFAULTS, useTargetScaledK: false };
  const change = calcStraightPoolGbrChange(1600, 1600, {
    p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4, target: 30
  }, { d, k_m, sp });
  closeTo(change, 19.097658862876255);
});

test('GBR change: targetReference falls back to 40 when unset (0 behaves the same as 40 at target=30)', () => {
  const spZero = { ...STRAIGHT_POOL_DEFAULTS, targetReference: 0 };
  const spFortyExplicit = { ...STRAIGHT_POOL_DEFAULTS, targetReference: 40 };
  const matchData = { p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4, target: 30 };
  const changeZero = calcStraightPoolGbrChange(1600, 1600, matchData, { d, k_m, sp: spZero });
  const changeForty = calcStraightPoolGbrChange(1600, 1600, matchData, { d, k_m, sp: spFortyExplicit });
  assert.equal(changeZero, changeForty);
});

test('GBR change: missing matchData.target falls back to sp.startTarget', () => {
  const sp = { ...STRAIGHT_POOL_DEFAULTS, startTarget: 30 };
  const withExplicitTarget = calcStraightPoolGbrChange(1600, 1600, {
    p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4, target: 30
  }, { d, k_m, sp });
  const withNoTarget = calcStraightPoolGbrChange(1600, 1600, {
    p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4
  }, { d, k_m, sp });
  assert.equal(withExplicitTarget, withNoTarget);
});

test('GBR change: zero-sum between the two players\' perspectives (moderate, non-clamped result)', () => {
  const sp = STRAIGHT_POOL_DEFAULTS;
  const changeA = calcStraightPoolGbrChange(1700, 1500, {
    p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4, target: 30
  }, { d, k_m, sp });
  const changeB = calcStraightPoolGbrChange(1500, 1700, {
    p1Points: 16, p2Points: 30, innings: 9, p1HighRun: 4, p2HighRun: 9, target: 30
  }, { d, k_m, sp });
  closeTo(changeA + changeB, 0, 1e-9);
  closeTo(changeA, 4.282972154780807);
});

test('GBR change: a drawn match at equal GBR nets to zero change', () => {
  const sp = STRAIGHT_POOL_DEFAULTS;
  const change = calcStraightPoolGbrChange(1600, 1600, {
    p1Points: 20, p2Points: 20, innings: 10, p1HighRun: 5, p2HighRun: 5, target: 40
  }, { d, k_m, sp });
  closeTo(change, 0);
});

// ---------------------------------------------------------------------------
// 4. NPD / point differential normalization
// ---------------------------------------------------------------------------

test('NPD: positive, negative, and zero differential, normalized by target', () => {
  closeTo(calcNPD(30, 16, 30), 0.4666666666666667);
  closeTo(calcNPD(16, 30, 30), -0.4666666666666667);
  assert.equal(calcNPD(20, 20, 30), 0);
});

test('NPD: non-positive target normalizes to T=1', () => {
  assert.equal(calcNPD(5, 3, 0), 2);
});

// ---------------------------------------------------------------------------
// 5. Target assignment
// ---------------------------------------------------------------------------

test('tier targets: rounds before tieringStartsRound all use startTarget', () => {
  const sp = STRAIGHT_POOL_DEFAULTS; // tieringStartsRound: 2, startTarget: 40
  const players = [1, 2, 3, 4, 5].map((id) => ({ id }));
  const tierMap = assignStraightPoolTierTargets(players, 1, sp);
  for (const p of players) assert.equal(tierMap[p.id], 40);
});

test('tier targets: even split with no remainder (6 players / 3 tiers of 50/40/30)', () => {
  const sp = STRAIGHT_POOL_DEFAULTS;
  const players = [1, 2, 3, 4, 5, 6].map((id) => ({ id }));
  const tierMap = assignStraightPoolTierTargets(players, 2, sp);
  assert.deepEqual([tierMap[1], tierMap[2], tierMap[3], tierMap[4], tierMap[5], tierMap[6]], [50, 50, 40, 40, 30, 30]);
});

test('tier targets: remainder is distributed to the higher (earlier) tiers first', () => {
  const sp = STRAIGHT_POOL_DEFAULTS; // tierTargets [50,40,30], 7 players -> base 2, extra 1 -> tier0 gets 3
  const players = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id }));
  const tierMap = assignStraightPoolTierTargets(players, 2, sp);
  assert.deepEqual([tierMap[1], tierMap[2], tierMap[3], tierMap[4], tierMap[5], tierMap[6], tierMap[7]], [50, 50, 50, 40, 40, 30, 30]);
});

test('match target: max of the two players\' tier targets, falling back to sp.startTarget when unmapped', () => {
  const sp = STRAIGHT_POOL_DEFAULTS;
  const tierMap = { a: 30, b: 50 };
  assert.equal(getStraightPoolTargetForMatch({ id: 'a' }, { id: 'b' }, tierMap, sp), 50);
  assert.equal(getStraightPoolTargetForMatch({ id: 'a' }, { id: 'unmapped' }, tierMap, sp), 40);
});

// ---------------------------------------------------------------------------
// 6. 14.1 standings
// ---------------------------------------------------------------------------

test('standings (classic): MP -> PERF -> Point Diff -> GD -> HS -> ID', () => {
  const higherMp = player({ id: 1, mp: 2 });
  const lowerMp = player({ id: 2, mp: 1 });
  assert.equal(compareStraightPool(higherMp, lowerMp, 'classic') < 0, true); // higherMp sorts first

  const higherPerf = player({ id: 1, mp: 1, perf: 1700, perfCount: 1 });
  const lowerPerf = player({ id: 2, mp: 1, perf: 1600, perfCount: 1 });
  assert.equal(compareStraightPool(higherPerf, lowerPerf, 'classic') < 0, true);

  const higherPd = player({ id: 1, mp: 1, perf: 1600, perfCount: 1, pointsFor: 30, pointsAgainst: 10 });
  const lowerPd = player({ id: 2, mp: 1, perf: 1600, perfCount: 1, pointsFor: 20, pointsAgainst: 15 });
  assert.equal(compareStraightPool(higherPd, lowerPd, 'classic') < 0, true);

  const higherGd = player({ id: 1, mp: 1, perf: 1600, perfCount: 1, pointsFor: 20, pointsAgainst: 5, inningsTotal: 4 }); // gd 5
  const lowerGd = player({ id: 2, mp: 1, perf: 1600, perfCount: 1, pointsFor: 20, pointsAgainst: 5, inningsTotal: 10 }); // gd 2
  assert.equal(compareStraightPool(higherGd, lowerGd, 'classic') < 0, true);

  const higherHs = player({ id: 1, mp: 1, perf: 1600, perfCount: 1, pointsFor: 20, pointsAgainst: 5, inningsTotal: 4, hs: 14 });
  const lowerHs = player({ id: 2, mp: 1, perf: 1600, perfCount: 1, pointsFor: 20, pointsAgainst: 5, inningsTotal: 4, hs: 9 });
  assert.equal(compareStraightPool(higherHs, lowerHs, 'classic') < 0, true);

  const lowId = player({ id: 1, mp: 1, perf: 1600, perfCount: 1, pointsFor: 20, pointsAgainst: 5, inningsTotal: 4, hs: 9 });
  const highId = player({ id: 2, mp: 1, perf: 1600, perfCount: 1, pointsFor: 20, pointsAgainst: 5, inningsTotal: 4, hs: 9 });
  assert.equal(compareStraightPool(lowId, highId, 'classic'), -1);
});

test('standings (point-differential/"racks"): MP -> Point Diff -> PERF -> GD -> HS -> ID', () => {
  // Same PERF/PD values as the classic test, but ordering of the 2nd/3rd tiebreak swaps:
  // point-diff-favored player should now win even though its PERF is lower.
  const higherPdLowerPerf = player({ id: 1, mp: 1, perf: 1500, perfCount: 1, pointsFor: 30, pointsAgainst: 10 });
  const lowerPdHigherPerf = player({ id: 2, mp: 1, perf: 1700, perfCount: 1, pointsFor: 20, pointsAgainst: 15 });
  assert.equal(compareStraightPool(higherPdLowerPerf, lowerPdHigherPerf, 'racks') < 0, true);
  // But under classic mode the same two players sort the other way (PERF decides first).
  assert.equal(compareStraightPool(higherPdLowerPerf, lowerPdHigherPerf, 'classic') > 0, true);
});

// ---------------------------------------------------------------------------
// 7. Format detection / default config
// ---------------------------------------------------------------------------

test('isStraightPool: true only for the exact experimental format string', () => {
  assert.equal(isStraightPool('straight_pool_14_1'), true);
  assert.equal(isStraightPool('fixed_rack'), false);
  assert.equal(isStraightPool(undefined), false);
});

test('getSP: missing straightPool config returns the defaults untouched', () => {
  assert.deepEqual(getSP(undefined), STRAIGHT_POOL_DEFAULTS);
  assert.deepEqual(getSP(null), STRAIGHT_POOL_DEFAULTS);
});

test('getSP: partial config is merged on top of defaults, not replacing them', () => {
  const sp = getSP({ k_14_1: 25, startTarget: 30 });
  assert.equal(sp.k_14_1, 25);
  assert.equal(sp.startTarget, 30);
  // untouched fields keep their defaults
  assert.equal(sp.useTargetScaledK, STRAIGHT_POOL_DEFAULTS.useTargetScaledK);
  assert.deepEqual(sp.tierTargets, STRAIGHT_POOL_DEFAULTS.tierTargets);
});
