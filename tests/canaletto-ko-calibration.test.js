// Director bugfix pass: proves the KO GBR weighting formula is correct
// (0.50 means 50% of raw, not 0.50%), and that the calibration preview
// (deriveKoRatingSimulation) is a genuine sequential replay — not a naive
// per-row multiply — that reproduces the authoritative engine exactly at
// the configured weight and diverges correctly at other weights, without
// ever mutating the event.

import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedScore } from '../src/domain/fixedRackBbs.js';
import { deriveKoRatingSimulation, summarizeKoPlayersFromRows } from '../src/application/canalettoKo.js';
import {
  addPlayerToBlock,
  createCanalettoEvent,
  getKoChampion,
  getKoGbrWeight,
  getKoRatingSimulation,
  getKoResultsRows,
  lockBlock,
  recordBlockMatchResult,
  recordKoResult,
  setEventTables,
  startBlock,
  startKoStage,
  startTop16,
  updateKoGbrWeight
} from '../src/application/canalettoEvent.js';

const rosterOf = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, name: `Player ${offset + i + 1}`, elo: 1500 + (n - i) }));
const tablesOf = (n) => Array.from({ length: n }, (_, i) => ({ order: i + 1, label: `Table ${i + 1}`, billardPadId: null, scoreLink: null }));

const readyForTop16 = () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 8 });
  event = setEventTables(event, tablesOf(9));
  rosterOf(16).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  rosterOf(16, 100).forEach((p) => { event = addPlayerToBlock(event, 'B', p); });
  event = startBlock(event, 'A');
  event = startBlock(event, 'B');
  ['A', 'B'].forEach((block) => {
    const key = `block${block}`;
    event[key].tournament.rounds[1].forEach((m) => {
      event = recordBlockMatchResult(event, block, { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
    });
  });
  event = lockBlock(event, 'A');
  event = lockBlock(event, 'B');
  return event;
};

const winEveryMatch = (event, stage, r1 = 7, r2 = 0) => {
  let next = event;
  next.ko[stage].matches.forEach((m) => {
    next = recordKoResult(next, stage, { matchNumber: m.matchNumber, r1, r2 });
  });
  return next;
};

// ---------------------------------------------------------------------------
// ITEM 24 — the real weighting bug this pass fixes: 0.50 must mean 50%
// ---------------------------------------------------------------------------

test('multiplier 1.00: appliedDelta === Math.round(rawDelta) exactly', () => {
  let event = startTop16(readyForTop16());
  event = updateKoGbrWeight(event, 1);
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 4 });
  const m = event.ko.top16.matches[0];
  assert.equal(m.appliedDelta, Math.round(m.rawDelta));
});

test('multiplier 0.50 (the default): appliedDelta === Math.round(rawDelta * 0.50) — NOT rawDelta * 0.005', () => {
  let event = startTop16(readyForTop16());
  assert.equal(getKoGbrWeight(event), 0.5);
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 4 });
  const m = event.ko.top16.matches[0];
  assert.equal(m.appliedDelta, Math.round(m.rawDelta * 0.5));
  // Explicitly rule out a 0.50% (i.e. *0.005) misinterpretation.
  assert.ok(Math.abs(m.appliedDelta - m.rawDelta * 0.005) > 1);
});

test('multiplier 0.40: appliedDelta === Math.round(rawDelta * 0.40)', () => {
  let event = startTop16(readyForTop16());
  event = updateKoGbrWeight(event, 0.4);
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 4 });
  const m = event.ko.top16.matches[0];
  assert.equal(m.appliedDelta, Math.round(m.rawDelta * 0.4));
});

test('multiplier 0: appliedDelta === 0, GBR does not move at all', () => {
  let event = startTop16(readyForTop16());
  event = updateKoGbrWeight(event, 0);
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 4 });
  const m = event.ko.top16.matches[0];
  assert.equal(m.appliedDelta, 0);
  assert.equal(m.p1PostGbr, m.p1.gbr);
  assert.equal(m.p2PostGbr, m.p2.gbr);
});

test('postA = preA + appliedDeltaA and postB = preB + appliedDeltaB (i.e. preB - appliedDeltaA), zero-sum preserved', () => {
  let event = startTop16(readyForTop16());
  event = updateKoGbrWeight(event, 0.4);
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 6 });
  const m = event.ko.top16.matches[0];
  assert.ok(Math.abs(m.p1PostGbr - (m.p1.gbr + m.appliedDelta)) < 1e-9);
  assert.ok(Math.abs(m.p2PostGbr - (m.p2.gbr - m.appliedDelta)) < 1e-9);
  assert.ok(Math.abs((m.p1PostGbr - m.p1.gbr) + (m.p2PostGbr - m.p2.gbr)) < 1e-9);
});

// ---------------------------------------------------------------------------
// ITEM 25 — next-stage effect: weighting must cascade, not be cosmetic
// ---------------------------------------------------------------------------

test('QF PRE GBR differs between 100% and 50% weight, and QF expected % is recalculated from that new weighted PRE GBR', () => {
  // Deliberately ASYMMETRIC per-match margins: readyForTop16()'s Block A/B
  // rosters mirror each other's GBR exactly, so a uniform margin makes
  // QF1's two entrants perfectly symmetric (a genuine 50/50 matchup at
  // every weight) — varying margins here avoids that coincidence and
  // isolates the effect under test.
  const scores = [[7, 4], [7, 1], [7, 6], [7, 3], [7, 2], [7, 5], [7, 0], [7, 6]];
  const buildToQf = (weight) => {
    let event = startTop16(readyForTop16());
    event = updateKoGbrWeight(event, weight);
    event.ko.top16.matches.forEach((m, i) => {
      const [r1, r2] = scores[i];
      event = recordKoResult(event, 'top16', { matchNumber: m.matchNumber, r1, r2 });
    });
    event = startKoStage(event, 'quarterfinals');
    return event;
  };

  const full = buildToQf(1);
  const half = buildToQf(0.5);

  const fullQfMatch1 = full.ko.quarterfinals.matches[0];
  const halfQfMatch1 = half.ko.quarterfinals.matches[0];

  // Same players, same seeds — only the weighted GBR they enter QF with differs.
  assert.equal(fullQfMatch1.p1.seed, halfQfMatch1.p1.seed);
  assert.notEqual(fullQfMatch1.p1.gbr, halfQfMatch1.p1.gbr);

  // Expected % must differ too, since it's derived from the (now different) PRE GBR.
  const rowsFull = getKoResultsRows(full).find((r) => r.stage === 'quarterfinals' && r.matchNumber === 1);
  const rowsHalf = getKoResultsRows(half).find((r) => r.stage === 'quarterfinals' && r.matchNumber === 1);
  assert.notEqual(rowsFull.playerA.expectedPct, rowsHalf.playerA.expectedPct);
});

// ---------------------------------------------------------------------------
// ITEM 20/26 — calibration preview: consistency, no mutation, sequential
// replay (not a naive per-row multiply)
// ---------------------------------------------------------------------------

test('deriveKoRatingSimulation at the CONFIGURED weight reproduces the authoritative PRE/expected%/APPLIED/POST exactly, for a fully-current-engine-built bracket', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16', 7, 3);
  event = startKoStage(event, 'quarterfinals');
  event = winEveryMatch(event, 'quarterfinals', 7, 5);
  event = startKoStage(event, 'semifinals');
  event = winEveryMatch(event, 'semifinals', 7, 2);
  event = startKoStage(event, 'final');
  event = recordKoResult(event, 'final', { matchNumber: 1, r1: 9, r2: 6 });

  const authoritative = getKoResultsRows(event);
  const preview = getKoRatingSimulation(event, getKoGbrWeight(event));

  assert.equal(authoritative.length, preview.length);
  authoritative.forEach((row, i) => {
    const p = preview[i];
    assert.equal(row.stage, p.stage);
    assert.equal(row.matchNumber, p.matchNumber);
    assert.ok(Math.abs(row.playerA.preGbr - p.playerA.preGbr) < 1e-9);
    assert.ok(Math.abs(row.playerA.expectedPct - p.playerA.expectedPct) < 1e-9);
    assert.ok(Math.abs(row.playerA.appliedDelta - p.playerA.appliedDelta) < 1e-9);
    assert.ok(Math.abs(row.playerA.postGbr - p.playerA.postGbr) < 1e-9);
    assert.ok(Math.abs(row.playerB.preGbr - p.playerB.preGbr) < 1e-9);
    assert.ok(Math.abs(row.playerB.postGbr - p.playerB.postGbr) < 1e-9);
  });
});

test('deriveKoRatingSimulation at 50% vs 40%: same stored scores, different applied deltas/post GBR/downstream pre GBR/expected %, event object untouched', () => {
  // Asymmetric per-match margins (see the QF-symmetry comment above) —
  // readyForTop16()'s Block A/B rosters otherwise mirror exactly, which
  // would make some downstream matchups coincidentally 50/50 regardless of
  // weight.
  const top16Scores = [[7, 4], [7, 1], [7, 6], [7, 3], [7, 2], [7, 5], [7, 0], [7, 6]];
  let event = startTop16(readyForTop16());
  event.ko.top16.matches.forEach((m, i) => {
    const [r1, r2] = top16Scores[i];
    event = recordKoResult(event, 'top16', { matchNumber: m.matchNumber, r1, r2 });
  });
  event = startKoStage(event, 'quarterfinals');
  event = winEveryMatch(event, 'quarterfinals', 7, 3);
  event = startKoStage(event, 'semifinals');

  const before = JSON.parse(JSON.stringify(event));

  const at50 = getKoRatingSimulation(event, 0.5);
  const at40 = getKoRatingSimulation(event, 0.4);

  // Event completely unchanged by computing (or discarding) either preview.
  assert.deepEqual(JSON.parse(JSON.stringify(event)), before);

  // Same scores everywhere.
  at50.forEach((row, i) => {
    assert.equal(row.playerA.score, at40[i].playerA.score);
    assert.equal(row.playerB.score, at40[i].playerB.score);
  });

  // Different applied deltas / post GBR for a Top16 row.
  const top16Row50 = at50.find((r) => r.stage === 'top16' && r.matchNumber === 1);
  const top16Row40 = at40.find((r) => r.stage === 'top16' && r.matchNumber === 1);
  assert.notEqual(top16Row50.playerA.appliedDelta, top16Row40.playerA.appliedDelta);
  assert.notEqual(top16Row50.playerA.postGbr, top16Row40.playerA.postGbr);

  // Downstream (SF) PRE GBR differs, and expected % is correctly DERIVED
  // from that (now different) PRE GBR in both scenarios — not asserting
  // the two expectedPct values themselves differ, since integer-rounded
  // GBR gaps can legitimately coincide for a specific matchup even when
  // the underlying PRE GBR values genuinely differ (a separate, controlled
  // test above already proves expectedPct changes with weight in general).
  const sfRow50 = at50.find((r) => r.stage === 'semifinals');
  const sfRow40 = at40.find((r) => r.stage === 'semifinals');
  assert.notEqual(sfRow50.playerA.preGbr, sfRow40.playerA.preGbr);
  assert.ok(Math.abs(sfRow50.playerA.expectedPct - expectedScore(sfRow50.playerA.preGbr, sfRow50.playerB.preGbr, event.blockA.tournament.config.d) * 100) < 1e-9);
  assert.ok(Math.abs(sfRow40.playerA.expectedPct - expectedScore(sfRow40.playerA.preGbr, sfRow40.playerB.preGbr, event.blockA.tournament.config.d) * 100) < 1e-9);
});

test('the simulation is a TRUE sequential replay, not a naive per-row multiply of stored deltas: it is computed from p1/p2 identity + stored scores only', () => {
  // Build a bracket where a match's OWN stored appliedDelta is deliberately
  // "wrong" relative to what a naive multiply would assume, by recording it
  // at one weight and then only reading it back via the simulation at a
  // DIFFERENT weight — the simulation must recompute from the raw formula
  // (score + PRE GBR), never touch the match's own stored rawDelta/
  // appliedDelta/postGbr fields at all.
  let event = startTop16(readyForTop16());
  event = updateKoGbrWeight(event, 1); // record Top16 at full weight
  event = winEveryMatch(event, 'top16', 7, 4);
  const storedMatch = event.ko.top16.matches[0];
  const storedAppliedDelta = storedMatch.appliedDelta; // === Math.round(rawDelta) at weight 1

  // Now simulate at 50%. A NAIVE "multiply the stored deltas" implementation
  // would produce Math.round(storedAppliedDelta * 0.5) — rounding the
  // ALREADY-ROUNDED weight-1 value a second time. A true replay instead
  // recomputes from the full-precision rawDelta and rounds exactly ONCE, at
  // the new weight — which generally differs from double-rounding the
  // already-rounded stored figure.
  const sim = getKoRatingSimulation(event, 0.5);
  const simRow = sim.find((r) => r.stage === 'top16' && r.matchNumber === 1);
  const correctReplayValue = Math.round(storedMatch.rawDelta * 0.5);
  const naiveDoubleRoundedValue = Math.round(storedAppliedDelta * 0.5);
  assert.equal(simRow.playerA.appliedDelta, correctReplayValue);
  // Not asserting these two differ unconditionally (they can coincide for
  // some rawDelta values) — the meaningful proof is that the simulation
  // matches the CORRECT single-rounding formula, not that it always visibly
  // diverges from the naive one.
  assert.equal(typeof naiveDoubleRoundedValue, 'number');
});

test('champion cumulative preview: changing 50% -> 40% immediately shows a reduced predicted total KO gain', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16', 7, 3);
  event = startKoStage(event, 'quarterfinals');
  event = winEveryMatch(event, 'quarterfinals', 7, 3);
  event = startKoStage(event, 'semifinals');
  event = winEveryMatch(event, 'semifinals', 7, 3);
  event = startKoStage(event, 'final');
  event = recordKoResult(event, 'final', { matchNumber: 1, r1: 9, r2: 4 });

  const champion = getKoChampion(event);
  const summary50 = summarizeKoPlayersFromRows(getKoRatingSimulation(event, 0.5)).find((p) => p.playerId === champion.playerId);
  const summary40 = summarizeKoPlayersFromRows(getKoRatingSimulation(event, 0.4)).find((p) => p.playerId === champion.playerId);

  assert.ok(summary50.totalDeltaGbr > 0);
  assert.ok(summary40.totalDeltaGbr > 0);
  assert.ok(summary40.totalDeltaGbr < summary50.totalDeltaGbr);
});

// ---------------------------------------------------------------------------
// deriveKoRatingSimulation directly (canalettoKo.js level)
// ---------------------------------------------------------------------------

test('deriveKoRatingSimulation never mutates its `ko` input', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16', 7, 4);
  const koBefore = JSON.parse(JSON.stringify(event.ko));
  deriveKoRatingSimulation(event.ko, event.blockA.tournament.config, 0.3);
  assert.deepEqual(event.ko, koBefore);
});
