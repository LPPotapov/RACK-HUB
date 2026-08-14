import assert from 'node:assert/strict';
import test from 'node:test';
import { gbrChange } from '../src/domain/fixedRackBbs.js';
import {
  KO_RACE_TO,
  assignKoMatchTable,
  buildNextStagePairings,
  confirmKoStageTables,
  createKoStage,
  editKoStageTables,
  getKoChampion,
  isKoStageComplete,
  isValidKoScore,
  recordKoMatchResult
} from '../src/application/canalettoKo.js';

const GBR_CONFIG = { d: 330, k_m: 30, k_r: 20 };
// This file exercises bracket/propagation/table mechanics, not the KO GBR
// weighting itself (see canaletto-ko-gbr-weight.test.js for that) — weight
// 1 keeps appliedDelta === rawDelta so every existing assertion here still
// reads as "the raw BBS change", unchanged.
const NO_WEIGHT = 1;

const seed = (seedLabel, playerId, name, gbr) => ({ seed: seedLabel, playerId, name, gbr });

const top16Pairings = () => [
  { matchNumber: 1, top: seed('A1', 1, 'Alice', 1850), bottom: seed('B8', 8, 'Hank', 1550) },
  { matchNumber: 2, top: seed('B1', 108, 'Beth', 1840), bottom: seed('A8', 108 + 1, 'Ivan', 1560) },
  { matchNumber: 3, top: seed('A2', 2, 'Carl', 1800), bottom: seed('B7', 107, 'Gina', 1580) },
  { matchNumber: 4, top: seed('B2', 102, 'Dana', 1790), bottom: seed('A7', 7, 'Jill', 1590) },
  { matchNumber: 5, top: seed('A3', 3, 'Erik', 1770), bottom: seed('B6', 106, 'Fiona', 1600) },
  { matchNumber: 6, top: seed('B3', 103, 'Gus', 1760), bottom: seed('A6', 6, 'Hana', 1610) },
  { matchNumber: 7, top: seed('A4', 4, 'Ivo', 1740), bottom: seed('B5', 105, 'Jana', 1620) },
  { matchNumber: 8, top: seed('B4', 104, 'Kim', 1730), bottom: seed('A5', 5, 'Liam', 1630) }
];

// ---------------------------------------------------------------------------
// RACE SCORE VALIDATION
// ---------------------------------------------------------------------------

test('race-to-7 accepts valid scores', () => {
  assert.equal(isValidKoScore(7, 0, 7), true);
  assert.equal(isValidKoScore(7, 4, 7), true);
  assert.equal(isValidKoScore(7, 6, 7), true);
  assert.equal(isValidKoScore(0, 7, 7), true);
});

test('race-to-9 (Final) accepts valid scores', () => {
  assert.equal(isValidKoScore(9, 0, 9), true);
  assert.equal(isValidKoScore(9, 4, 9), true);
  assert.equal(isValidKoScore(9, 8, 9), true);
});

test('race-to rejects neither player at target', () => {
  assert.equal(isValidKoScore(6, 5, 7), false);
});

test('race-to rejects both players at target', () => {
  assert.equal(isValidKoScore(7, 7, 7), false);
});

test('race-to rejects a score above target', () => {
  assert.equal(isValidKoScore(8, 3, 7), false);
  assert.equal(isValidKoScore(7, 8, 7), false);
});

test('race-to rejects negative or non-integer scores', () => {
  assert.equal(isValidKoScore(-1, 7, 7), false);
  assert.equal(isValidKoScore(7, -1, 7), false);
  assert.equal(isValidKoScore(7.5, 4, 7), false);
  assert.equal(isValidKoScore(7, 'x', 7), false);
});

test('recordKoMatchResult requires both score fields to already be valid integers (no blank-side autocomplete)', () => {
  const stage = createKoStage(top16Pairings(), []);
  assert.throws(() => recordKoMatchResult(stage, { matchNumber: 1, r1: 7, r2: null }, 7, GBR_CONFIG, NO_WEIGHT), /invalid race-to-7/);
  assert.throws(() => recordKoMatchResult(stage, { matchNumber: 1, r1: null, r2: 7 }, 7, GBR_CONFIG, NO_WEIGHT), /invalid race-to-7/);
});

// ---------------------------------------------------------------------------
// SEED / START (via createKoStage — the Top16-specific composition is
// tested at the canalettoEvent.js level in canaletto-ko-event.test.js)
// ---------------------------------------------------------------------------

test('createKoStage builds exactly 8 Top16 matches preserving the exact A/B seed relationships', () => {
  const stage = createKoStage(top16Pairings(), []);
  assert.equal(stage.matches.length, 8);
  const seedPairs = stage.matches.map((m) => `${m.p1.seed} vs ${m.p2.seed}`);
  assert.deepEqual(seedPairs, [
    'A1 vs B8', 'B1 vs A8', 'A2 vs B7', 'B2 vs A7',
    'A3 vs B6', 'B3 vs A6', 'A4 vs B5', 'B4 vs A5'
  ]);
});

// ---------------------------------------------------------------------------
// BRACKET PROPAGATION — no reseeding
// ---------------------------------------------------------------------------

const completeStage = (stage, scores) => scores.reduce(
  (s, [matchNumber, r1, r2], i) => recordKoMatchResult(s, { matchNumber, r1, r2 }, KO_RACE_TO.top16, GBR_CONFIG, NO_WEIGHT),
  stage
);

test('winner of Top16 match 1 + winner of match 2 form Quarterfinal 1, in bracket order', () => {
  let stage = createKoStage(top16Pairings(), []);
  stage = completeStage(stage, [
    [1, 7, 3], // A1 (Alice) beats B8
    [2, 5, 7], // A8 (Ivan) beats B1
    [3, 7, 0], [4, 7, 0], [5, 7, 0], [6, 7, 0], [7, 7, 0], [8, 7, 0]
  ]);
  assert.equal(isKoStageComplete(stage), true);
  const qf = buildNextStagePairings(stage);
  assert.equal(qf.length, 4);
  assert.equal(qf[0].top.name, 'Alice');
  assert.equal(qf[0].bottom.name, 'Ivan');
});

test('all four Quarterfinal relationships derive from Top16 winners in stored order', () => {
  let stage = createKoStage(top16Pairings(), []);
  // p1 always wins each match, deterministically.
  stage = completeStage(stage, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, 7, 0]));
  const qf = buildNextStagePairings(stage);
  assert.deepEqual(qf.map((p) => p.matchNumber), [1, 2, 3, 4]);
  assert.equal(qf[0].top.seed, 'A1');
  assert.equal(qf[0].bottom.seed, 'B1');
  assert.equal(qf[1].top.seed, 'A2');
  assert.equal(qf[1].bottom.seed, 'B2');
  assert.equal(qf[2].top.seed, 'A3');
  assert.equal(qf[2].bottom.seed, 'B3');
  assert.equal(qf[3].top.seed, 'A4');
  assert.equal(qf[3].bottom.seed, 'B4');
});

test('Semifinal relationships derive from Quarterfinal winners in stored order', () => {
  let top16 = createKoStage(top16Pairings(), []);
  top16 = completeStage(top16, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, 7, 0]));
  let qf = createKoStage(buildNextStagePairings(top16), []);
  qf = completeStage(qf, [1, 2, 3, 4].map((n) => [n, 7, 0]));
  const sf = buildNextStagePairings(qf);
  assert.equal(sf.length, 2);
  assert.equal(sf[0].top.seed, 'A1');
  assert.equal(sf[0].bottom.seed, 'A2');
  assert.equal(sf[1].top.seed, 'A3');
  assert.equal(sf[1].bottom.seed, 'A4');
});

test('Final relationship derives from Semifinal winners, no reseeding at any stage', () => {
  let top16 = createKoStage(top16Pairings(), []);
  top16 = completeStage(top16, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, 7, 0]));
  let qf = createKoStage(buildNextStagePairings(top16), []);
  qf = completeStage(qf, [1, 2, 3, 4].map((n) => [n, 7, 0]));
  let sf = createKoStage(buildNextStagePairings(qf), []);
  sf = completeStage(sf, [1, 2].map((n) => [n, 7, 0]));
  const final = buildNextStagePairings(sf);
  assert.equal(final.length, 1);
  assert.equal(final[0].top.seed, 'A1');
  assert.equal(final[0].bottom.seed, 'A3');
});

test('buildNextStagePairings refuses when the stage is not yet complete', () => {
  const stage = createKoStage(top16Pairings(), []);
  assert.throws(() => buildNextStagePairings(stage), /must be complete/);
});

// ---------------------------------------------------------------------------
// FROZEN DISPLAY
// ---------------------------------------------------------------------------

test('a Top16 match freezes each player\'s pre-match GBR from the seed slot', () => {
  const stage = createKoStage(top16Pairings(), []);
  assert.equal(stage.matches[0].p1.gbr, 1850);
  assert.equal(stage.matches[0].p2.gbr, 1550);
});

test('completing a match does not alter its own frozen pre-match GBR display', () => {
  const stage = createKoStage(top16Pairings(), []);
  const before = { p1Gbr: stage.matches[0].p1.gbr, p2Gbr: stage.matches[0].p2.gbr };
  const after = recordKoMatchResult(stage, { matchNumber: 1, r1: 7, r2: 3 }, 7, GBR_CONFIG, NO_WEIGHT);
  assert.equal(after.matches[0].p1.gbr, before.p1Gbr);
  assert.equal(after.matches[0].p2.gbr, before.p2Gbr);
});

test('completing a match does not alter ANY other match\'s frozen display in the same stage', () => {
  const stage = createKoStage(top16Pairings(), []);
  const otherBefore = JSON.parse(JSON.stringify(stage.matches[3]));
  const after = recordKoMatchResult(stage, { matchNumber: 1, r1: 7, r2: 3 }, 7, GBR_CONFIG, NO_WEIGHT);
  assert.deepEqual(after.matches[3], otherBefore);
});

test('the next generated stage snapshots the winner\'s UPDATED post-match GBR as its own pre-match GBR', () => {
  let stage = createKoStage(top16Pairings(), []);
  stage = recordKoMatchResult(stage, { matchNumber: 1, r1: 7, r2: 3 }, 7, GBR_CONFIG, NO_WEIGHT); // Alice beats Hank
  const match1 = stage.matches[0];
  assert.notEqual(match1.p1PostGbr, match1.p1.gbr); // GBR actually moved
  stage = completeStage(stage, [[2, 7, 0], [3, 7, 0], [4, 7, 0], [5, 7, 0], [6, 7, 0], [7, 7, 0], [8, 7, 0]]);
  const qf = buildNextStagePairings(stage);
  assert.equal(qf[0].top.gbr, match1.p1PostGbr);
});

// ---------------------------------------------------------------------------
// TABLES
// ---------------------------------------------------------------------------

test('a stage is seeded with tables in configured preferred order, first N', () => {
  const tables = ['301 TV', 'Table 2', 'Table 3', 'Table 4', 'Table 5', 'Table 6', 'Table 7', 'Table 8', 'Table 9'];
  const stage = createKoStage(top16Pairings(), tables.slice(0, 8));
  assert.deepEqual(stage.matches.map((m) => m.tbl), tables.slice(0, 8));
});

test('confirmKoStageTables/editKoStageTables toggle tablesConfirmed', () => {
  let stage = createKoStage(top16Pairings(), []);
  assert.equal(stage.tablesConfirmed, false);
  stage = confirmKoStageTables(stage);
  assert.equal(stage.tablesConfirmed, true);
  stage = editKoStageTables(stage);
  assert.equal(stage.tablesConfirmed, false);
});

test('assignKoMatchTable changes only the targeted match\'s table', () => {
  let stage = createKoStage(top16Pairings(), []);
  stage = assignKoMatchTable(stage, 2, 'Table 9');
  assert.equal(stage.matches[1].tbl, 'Table 9');
  assert.equal(stage.matches[0].tbl, null);
});

// ---------------------------------------------------------------------------
// CHAMPION
// ---------------------------------------------------------------------------

test('getKoChampion is null until the Final stage is complete', () => {
  assert.equal(getKoChampion(null), null);
  const stage = createKoStage([{ matchNumber: 1, top: seed('A1', 1, 'Alice', 1850), bottom: seed('A3', 3, 'Erik', 1770) }], []);
  assert.equal(getKoChampion(stage), null);
});

test('getKoChampion returns the Final winner as champion and loser as runner-up', () => {
  let stage = createKoStage([{ matchNumber: 1, top: seed('A1', 1, 'Alice', 1850), bottom: seed('A3', 3, 'Erik', 1770) }], []);
  stage = recordKoMatchResult(stage, { matchNumber: 1, r1: 9, r2: 6 }, 9, GBR_CONFIG, NO_WEIGHT);
  const champion = getKoChampion(stage);
  assert.equal(champion.playerId, 1);
  assert.equal(champion.name, 'Alice');
  assert.equal(champion.runnerUpId, 3);
  assert.equal(champion.runnerUpName, 'Erik');
  assert.equal(champion.r1, 9);
  assert.equal(champion.r2, 6);
});

// ---------------------------------------------------------------------------
// GBR — recordKoMatchResult uses the EXISTING, UNMODIFIED gbrChange() formula
// directly on the actual race-to rack counts, with no scaling.
// ---------------------------------------------------------------------------

test('recordKoMatchResult\'s RAW delta is byte-for-byte the existing gbrChange(gbrA, gbrB, r1, r2, config) call; POST GBR applies the GBR_INTEGER_RULE rounding on top', () => {
  let stage = createKoStage(top16Pairings(), []);
  stage = recordKoMatchResult(stage, { matchNumber: 1, r1: 7, r2: 4 }, 7, GBR_CONFIG, NO_WEIGHT);
  const match = stage.matches[0];
  const expectedChange = gbrChange(1850, 1550, 7, 4, GBR_CONFIG);
  assert.equal(match.rawDelta, expectedChange);
  assert.equal(match.appliedDelta, Math.round(expectedChange));
  assert.equal(match.p1PostGbr, 1850 + Math.round(expectedChange));
  assert.equal(match.p2PostGbr, 1550 - Math.round(expectedChange));
});
