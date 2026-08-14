// Director correction pass: Single-KO GBR weight (director-authorized
// methodology decision — applies the existing, UNMODIFIED raw BBS change,
// then weights it by a Canaletto-only, KO-only multiplier before it becomes
// a player's actual progressing GBR). Covers: default/persistence, raw vs
// applied math, zero-sum for both, next-stage weighted-GBR propagation,
// frozen-display invariance, KO Player Summary, and champion total ΔGBR.

import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedScore, gbrChange } from '../src/domain/fixedRackBbs.js';
import { DEFAULT_KO_GBR_WEIGHT } from '../src/application/canalettoKo.js';
import {
  addPlayerToBlock,
  createCanalettoEvent,
  getKoChampionSummary,
  getKoGbrWeight,
  getKoPlayerSummary,
  getKoResultsRows,
  lockBlock,
  recordBlockMatchResult,
  recordKoResult,
  setEventTables,
  startBlock,
  startKoStage,
  startTop16,
  updateKoGbrWeight,
  validateCanalettoEvent
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
// KO GBR WEIGHT — default / persistence / validation
// ---------------------------------------------------------------------------

test('DEFAULT_KO_GBR_WEIGHT is 0.50', () => {
  assert.equal(DEFAULT_KO_GBR_WEIGHT, 0.5);
});

test('a freshly created event defaults koGbrWeight to 0.50', () => {
  const event = createCanalettoEvent();
  assert.equal(event.koGbrWeight, 0.5);
  assert.equal(getKoGbrWeight(event), 0.5);
});

test('older/restored state with no koGbrWeight field safely defaults to 0.50', () => {
  const event = createCanalettoEvent();
  const legacyEvent = { ...event };
  delete legacyEvent.koGbrWeight;
  assert.equal(getKoGbrWeight(legacyEvent), 0.5);
});

test('updateKoGbrWeight persists a configured value', () => {
  let event = createCanalettoEvent();
  event = updateKoGbrWeight(event, 0.3);
  assert.equal(event.koGbrWeight, 0.3);
  assert.equal(getKoGbrWeight(event), 0.3);
  const restored = JSON.parse(JSON.stringify(event));
  assert.equal(restored.koGbrWeight, 0.3);
  assert.deepEqual(validateCanalettoEvent(restored), { valid: true, errors: [] });
});

test('updateKoGbrWeight rejects negative values and values above 1 (100%)', () => {
  const event = createCanalettoEvent();
  assert.throws(() => updateKoGbrWeight(event, -0.1), /between 0 and 1/);
  assert.throws(() => updateKoGbrWeight(event, 1.1), /between 0 and 1/);
});

test('updateKoGbrWeight accepts the full 0..1 range, including the boundaries', () => {
  let event = createCanalettoEvent();
  event = updateKoGbrWeight(event, 0);
  assert.equal(event.koGbrWeight, 0);
  event = updateKoGbrWeight(event, 1);
  assert.equal(event.koGbrWeight, 1);
});

// ---------------------------------------------------------------------------
// RAW vs APPLIED — raw calculation unchanged; applied = raw * multiplier
// ---------------------------------------------------------------------------

test('the raw calculation is completely unaffected by koGbrWeight: match.rawDelta always equals gbrChange() directly', () => {
  let event = startTop16(readyForTop16());
  event = updateKoGbrWeight(event, 0.25);
  const before = event.ko.top16.matches[0];
  const gbrConfig = event.blockA.tournament.config;
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 5 });
  const after = event.ko.top16.matches[0];
  assert.ok(Math.abs(after.rawDelta - gbrChange(before.p1.gbr, before.p2.gbr, 7, 5, gbrConfig)) < 1e-9);
});

test('appliedDelta === Math.round(rawDelta * koGbrWeight), EXACTLY, at the default 50%', () => {
  let event = startTop16(readyForTop16());
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 4 });
  const match = event.ko.top16.matches[0];
  assert.equal(match.appliedDelta, Math.round(match.rawDelta * 0.5));
  assert.ok(Number.isInteger(match.appliedDelta));
  assert.ok(Number.isInteger(match.p1PostGbr));
  assert.ok(Number.isInteger(match.p2PostGbr));
});

test('appliedDelta scales with a configured non-default weight (25%), rounded once', () => {
  let event = startTop16(readyForTop16());
  event = updateKoGbrWeight(event, 0.25);
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 4 });
  const match = event.ko.top16.matches[0];
  assert.equal(match.appliedDelta, Math.round(match.rawDelta * 0.25));
  assert.ok(Number.isInteger(match.appliedDelta));
});

test('a weight of 100% (1.0) makes applied exactly Math.round(raw) — no weighting, one rounding', () => {
  let event = startTop16(readyForTop16());
  event = updateKoGbrWeight(event, 1);
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 4 });
  const match = event.ko.top16.matches[0];
  assert.equal(match.appliedDelta, Math.round(match.rawDelta));
});

test('a weight of 0% makes applied exactly 0 (GBR frozen through KO), while raw is still computed and visible', () => {
  let event = startTop16(readyForTop16());
  event = updateKoGbrWeight(event, 0);
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 4 });
  const match = event.ko.top16.matches[0];
  assert.equal(match.appliedDelta, 0);
  assert.notEqual(match.rawDelta, 0);
  assert.equal(match.p1PostGbr, match.p1.gbr);
  assert.equal(match.p2PostGbr, match.p2.gbr);
});

test('player B\'s applied change is exactly the negative of player A\'s applied change (zero-sum by construction, integer)', () => {
  let event = startTop16(readyForTop16());
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 4 });
  const match = event.ko.top16.matches[0];
  const row = getKoResultsRows(event).find((r) => r.stage === 'top16' && r.matchNumber === 1);
  assert.equal(row.playerB.appliedDelta, -row.playerA.appliedDelta);
  assert.ok(Number.isInteger(row.playerA.appliedDelta));
  assert.ok(Number.isInteger(row.playerB.appliedDelta));
});

test('no hard delta cap: a large weighted change is not clamped (docs task item 21)', () => {
  // Deliberately extreme unequal GBR + dominant score to produce a large raw
  // change, at weight 1.0 so applied === Math.round(raw) — proves nothing
  // clamps it beyond the single integer rounding.
  let event = startTop16(readyForTop16());
  event = updateKoGbrWeight(event, 1);
  event = recordKoResult(event, 'top16', { matchNumber: 2, r1: 0, r2: 7 }); // underdog B8-side wins big elsewhere too, doesn't matter
  const rows = getKoResultsRows(event);
  const row = rows.find((r) => r.matchNumber === 2);
  assert.ok(Math.abs(row.playerB.appliedDelta) > 0);
  // No cap constant exists in canalettoKo.js at all — this is a structural
  // assertion that the value used is exactly the formula's own output,
  // rounded once.
  assert.equal(row.playerB.appliedDelta, Math.round(row.playerB.rawDelta));
});

// ---------------------------------------------------------------------------
// RAW / APPLIED ZERO-SUM (docs task item 27) — APPLIED must be EXACT zero
// (integer arithmetic), not merely within floating tolerance. RAW stays
// floating-point internally, so it keeps a tolerance check.
// ---------------------------------------------------------------------------

test('for every completed match at the default weight, RAW is zero-sum within float tolerance and APPLIED is zero-sum EXACTLY (integer)', () => {
  let event = startTop16(readyForTop16());
  const scores = [[7, 0], [7, 3], [7, 6], [6, 7], [3, 7], [0, 7], [7, 1], [1, 7]];
  event.ko.top16.matches.forEach((m, i) => {
    const [r1, r2] = scores[i];
    event = recordKoResult(event, 'top16', { matchNumber: m.matchNumber, r1, r2 });
  });
  getKoResultsRows(event).forEach((r) => {
    assert.ok(Math.abs(r.playerA.rawDelta + r.playerB.rawDelta) < 1e-9);
    assert.equal(r.playerA.appliedDelta + r.playerB.appliedDelta, 0);
    assert.ok(Number.isInteger(r.playerA.appliedDelta));
    assert.ok(Number.isInteger(r.playerB.appliedDelta));
    assert.ok(Number.isInteger(r.playerA.postGbr));
    assert.ok(Number.isInteger(r.playerB.postGbr));
  });
});

test('zero-sum holds EXACTLY at a non-default weight too (25%)', () => {
  let event = updateKoGbrWeight(startTop16(readyForTop16()), 0.25);
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 6 });
  const row = getKoResultsRows(event).find((r) => r.matchNumber === 1);
  assert.ok(Math.abs(row.playerA.rawDelta + row.playerB.rawDelta) < 1e-9);
  assert.equal(row.playerA.appliedDelta + row.playerB.appliedDelta, 0);
  assert.ok(Number.isInteger(row.playerA.appliedDelta));
  assert.ok(Number.isInteger(row.playerB.appliedDelta));
});

// ---------------------------------------------------------------------------
// BLOCKS UNAFFECTED
// ---------------------------------------------------------------------------

test('Block A/B match results never call the KO weighting — recordBlockMatchResult produces the exact same GBR change regardless of koGbrWeight', () => {
  const buildAndScore = (weight) => {
    let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8 });
    event = updateKoGbrWeight(event, weight);
    rosterOf(4).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
    event = startBlock(event, 'A');
    const m = event.blockA.tournament.rounds[1][0];
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
    return event.blockA.tournament.players.find((p) => p.id === m.p1.id).elo;
  };
  assert.equal(buildAndScore(0.5), buildAndScore(0.1));
  assert.equal(buildAndScore(0.5), buildAndScore(1));
});

// ---------------------------------------------------------------------------
// PROGRESSION — next stage uses WEIGHTED (applied) GBR; frozen display holds
// ---------------------------------------------------------------------------

test('next stage\'s PRE GBR is the previous stage\'s WEIGHTED (applied) POST GBR, not raw', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16', 7, 4); // non-trivial margin so raw != applied
  const top16Match1 = event.ko.top16.matches[0];
  assert.notEqual(top16Match1.rawDelta, top16Match1.appliedDelta);

  event = startKoStage(event, 'quarterfinals');
  const qfMatch1 = event.ko.quarterfinals.matches[0];
  assert.ok(Math.abs(qfMatch1.p1.gbr - top16Match1.p1PostGbr) < 1e-9);
  // Specifically NOT the raw-weighted (i.e. unweighted) value.
  const rawPostGbr = top16Match1.p1.gbr + top16Match1.rawDelta;
  assert.notEqual(qfMatch1.p1.gbr, rawPostGbr);
});

test('next stage\'s expected win % is computed from the actual weighted GBR entering that stage', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16', 7, 4);
  event = startKoStage(event, 'quarterfinals');
  const qfRow = getKoResultsRows(event).find((r) => r.stage === 'quarterfinals' && r.matchNumber === 1);
  const qfMatch = event.ko.quarterfinals.matches[0];
  // expected% is derived from the match's own frozen p1.gbr/p2.gbr (the
  // weighted values QF was generated with) — cross-check against a direct
  // expectedScore() call using those same values.
  const gbrConfig = event.blockA.tournament.config;
  assert.ok(Math.abs(qfRow.playerA.expectedPct - expectedScore(qfMatch.p1.gbr, qfMatch.p2.gbr, gbrConfig.d) * 100) < 1e-9);
});

test('the OLD (previous-stage) frozen PRE GBR and expected win % remain unchanged after the next stage is generated and scored', () => {
  let event = startTop16(readyForTop16());
  const beforeGenQf = { p1: event.ko.top16.matches[0].p1.gbr, p2: event.ko.top16.matches[0].p2.gbr };
  event = winEveryMatch(event, 'top16', 7, 4);
  const afterTop16Complete = { p1: event.ko.top16.matches[0].p1.gbr, p2: event.ko.top16.matches[0].p2.gbr };
  assert.deepEqual(afterTop16Complete, beforeGenQf); // completing results never touches p1/p2.gbr

  event = startKoStage(event, 'quarterfinals');
  event = winEveryMatch(event, 'quarterfinals', 7, 2);
  const afterQfComplete = { p1: event.ko.top16.matches[0].p1.gbr, p2: event.ko.top16.matches[0].p2.gbr };
  assert.deepEqual(afterQfComplete, beforeGenQf); // still frozen, unaffected by QF happening
});

// ---------------------------------------------------------------------------
// KO PLAYER SUMMARY (docs task item 29)
// ---------------------------------------------------------------------------

test('KO Player Summary reports matches/wins/start/current GBR and total ΔGBR using APPLIED changes', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16', 7, 4); // p1 (A1) wins every Top16 match
  const top16Match1 = event.ko.top16.matches[0];
  const summary = getKoPlayerSummary(event);
  const a1 = summary.find((p) => p.playerId === top16Match1.p1.playerId);
  assert.equal(a1.koMatches, 1);
  assert.equal(a1.koWins, 1);
  assert.equal(a1.startGbr, top16Match1.p1.gbr);
  assert.equal(a1.currentGbr, top16Match1.p1PostGbr);
  assert.equal(a1.totalDeltaGbr, top16Match1.appliedDelta);
  assert.ok(Number.isInteger(a1.currentGbr));
  assert.ok(Number.isInteger(a1.totalDeltaGbr));
});

test('a player who loses their only KO match has koWins 0 and totalDeltaGbr equal to their single applied loss', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16', 7, 4);
  const top16Match1 = event.ko.top16.matches[0];
  const summary = getKoPlayerSummary(event);
  const loser = summary.find((p) => p.playerId === top16Match1.p2.playerId);
  assert.equal(loser.koMatches, 1);
  assert.equal(loser.koWins, 0);
  assert.ok(loser.totalDeltaGbr < 0);
  assert.equal(loser.totalDeltaGbr, -top16Match1.appliedDelta);
  assert.ok(Number.isInteger(loser.totalDeltaGbr));
});

// ---------------------------------------------------------------------------
// CHAMPION TOTAL KO ΔGBR (docs task item 30) — must use APPLIED, not RAW
// ---------------------------------------------------------------------------

test('getKoChampionSummary is null until the Final is complete', () => {
  const event = startTop16(readyForTop16());
  assert.equal(getKoChampionSummary(event), null);
});

test('champion\'s total KO ΔGBR across all four rounds uses APPLIED changes, and differs from what raw changes would have produced', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16', 7, 3); // p1 (A1) wins every match throughout
  event = startKoStage(event, 'quarterfinals');
  event = winEveryMatch(event, 'quarterfinals', 7, 3);
  event = startKoStage(event, 'semifinals');
  event = winEveryMatch(event, 'semifinals', 7, 3);
  event = startKoStage(event, 'final');
  event = recordKoResult(event, 'final', { matchNumber: 1, r1: 9, r2: 4 });

  const championSummary = getKoChampionSummary(event);
  assert.ok(championSummary.totalDeltaGbr > 0);
  assert.ok(Number.isInteger(championSummary.totalDeltaGbr));
  assert.ok(Number.isInteger(championSummary.currentGbr));
  assert.ok(Number.isInteger(championSummary.startGbr));

  // Cross-check: sum of the champion's own APPLIED deltas across their 4
  // matches equals championSummary.totalDeltaGbr exactly (integer sum).
  const rows = getKoResultsRows(event).filter((r) =>
    (r.playerA.seed === 'A1') || (r.playerB.seed === 'A1')
  );
  assert.equal(rows.length, 4);
  const sumApplied = rows.reduce((total, r) => total + (r.playerA.seed === 'A1' ? r.playerA.appliedDelta : r.playerB.appliedDelta), 0);
  assert.equal(sumApplied, championSummary.totalDeltaGbr);

  // And it must NOT equal what summing RAW deltas would give (since weight
  // is the default 50%, raw and applied genuinely diverge here).
  const sumRaw = rows.reduce((total, r) => total + (r.playerA.seed === 'A1' ? r.playerA.rawDelta : r.playerB.rawDelta), 0);
  assert.notEqual(Math.round(sumRaw * 100), Math.round(sumApplied * 100));
});
