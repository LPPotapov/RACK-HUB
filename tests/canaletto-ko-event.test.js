import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPlayerToBlock,
  assignKoTable,
  canCorrectKoStage,
  canResetKoStage,
  canStartKoStage,
  confirmKoTables,
  createCanalettoEvent,
  editKoTables,
  getCurrentKoStage,
  getKoChampion,
  getTop16Status,
  lockBlock,
  recordBlockMatchResult,
  recordKoResult,
  resetKoStage,
  setEventTables,
  startBlock,
  startKoStage,
  startTop16,
  validateCanalettoEvent
} from '../src/application/canalettoEvent.js';

const rosterOf = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, name: `Player ${offset + i + 1}`, elo: 1500 + (n - i) }));

const tablesOf = (n) => Array.from({ length: n }, (_, i) => ({ order: i + 1, label: `Table ${i + 1}`, billardPadId: null, scoreLink: null }));

// A fully-locked 16v16 event, both blocks locked with exactly 8 qualifiers
// each, 12 event tables configured (enough for Top16's 8), ready for
// startTop16().
const readyForTop16 = () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 8 });
  event = setEventTables(event, tablesOf(12));
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
// SEED / START
// ---------------------------------------------------------------------------

test('cannot start Top16 before both blocks are locked', () => {
  let event = createCanalettoEvent();
  assert.equal(canStartKoStage(event, 'top16').ok, false);
  assert.throws(() => startTop16(event), /Both Block A and Block B/);
});

test('starting Top16 creates exactly 8 real matches with the exact A/B seed relationships', () => {
  let event = startTop16(readyForTop16());
  assert.equal(event.ko.top16.matches.length, 8);
  const seedPairs = event.ko.top16.matches.map((m) => `${m.p1.seed} vs ${m.p2.seed}`);
  assert.deepEqual(seedPairs, [
    'A1 vs B8', 'B1 vs A8', 'A2 vs B7', 'B2 vs A7',
    'A3 vs B6', 'B3 vs A6', 'A4 vs B5', 'B4 vs A5'
  ]);
});

test('cannot start Quarterfinals before Top16 is complete', () => {
  let event = startTop16(readyForTop16());
  assert.equal(canStartKoStage(event, 'quarterfinals').ok, false);
  assert.throws(() => startKoStage(event, 'quarterfinals'), /top16 is not complete/);
  // Complete only 7 of 8 — still not enough.
  event.ko.top16.matches.slice(0, 7).forEach((m) => {
    event = recordKoResult(event, 'top16', { matchNumber: m.matchNumber, r1: 7, r2: 0 });
  });
  assert.equal(canStartKoStage(event, 'quarterfinals').ok, false);
});

// ---------------------------------------------------------------------------
// BRACKET propagation through the full event-level command chain
// ---------------------------------------------------------------------------

test('full Top16 -> Quarterfinals -> Semifinals -> Final propagation with no reseeding', () => {
  let event = startTop16(readyForTop16());
  // p1 (the "top" seed of every pairing) wins every match throughout.
  event = winEveryMatch(event, 'top16');
  event = startKoStage(event, 'quarterfinals');
  assert.equal(event.ko.quarterfinals.matches.length, 4);
  assert.equal(event.ko.quarterfinals.matches[0].p1.seed, 'A1');
  assert.equal(event.ko.quarterfinals.matches[0].p2.seed, 'B1');

  event = winEveryMatch(event, 'quarterfinals');
  event = startKoStage(event, 'semifinals');
  assert.equal(event.ko.semifinals.matches.length, 2);
  assert.equal(event.ko.semifinals.matches[0].p1.seed, 'A1');
  assert.equal(event.ko.semifinals.matches[0].p2.seed, 'A2');

  event = winEveryMatch(event, 'semifinals');
  event = startKoStage(event, 'final');
  assert.equal(event.ko.final.matches.length, 1);
  assert.equal(event.ko.final.matches[0].p1.seed, 'A1');
  assert.equal(event.ko.final.matches[0].p2.seed, 'A3');

  event = recordKoResult(event, 'final', { matchNumber: 1, r1: 9, r2: 6 });
  const champion = getKoChampion(event);
  assert.equal(champion.playerId, event.ko.final.matches[0].p1.playerId);
  assert.equal(champion.r1, 9);
  assert.equal(champion.r2, 6);
});

// ---------------------------------------------------------------------------
// TABLES — configured preferred order, first N per stage; confirm/edit
// ---------------------------------------------------------------------------

test('Top16 uses only the first 4 configured tables (Slot 2 reuses Slot 1\'s tables), Quarterfinals the first 4, Semifinals the first 2, Final the first 1', () => {
  let event = startTop16(readyForTop16());
  assert.deepEqual(event.ko.top16.matches.map((m) => m.tbl), ['Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 1', 'Table 2', 'Table 3', 'Table 4']);

  event = winEveryMatch(event, 'top16');
  event = startKoStage(event, 'quarterfinals');
  assert.deepEqual(event.ko.quarterfinals.matches.map((m) => m.tbl), ['Table 1', 'Table 2', 'Table 3', 'Table 4']);

  event = winEveryMatch(event, 'quarterfinals');
  event = startKoStage(event, 'semifinals');
  assert.deepEqual(event.ko.semifinals.matches.map((m) => m.tbl), ['Table 1', 'Table 2']);

  event = winEveryMatch(event, 'semifinals');
  event = startKoStage(event, 'final');
  assert.deepEqual(event.ko.final.matches.map((m) => m.tbl), ['Table 1']);
});

test('confirming Top16 tables freezes them; assignKoTable is refused until editKoTables reopens them', () => {
  let event = startTop16(readyForTop16());
  event = confirmKoTables(event, 'top16');
  assert.equal(event.ko.top16.tablesConfirmed, true);
  assert.throws(() => assignKoTable(event, 'top16', { matchNumber: 1, table: 'Table 9' }), /confirmed and frozen/);
  event = editKoTables(event, 'top16');
  assert.equal(event.ko.top16.tablesConfirmed, false);
  event = assignKoTable(event, 'top16', { matchNumber: 1, table: 'Table 9' });
  assert.equal(event.ko.top16.matches[0].tbl, 'Table 9');
});

// ---------------------------------------------------------------------------
// PROGRESSION — next stage disabled until complete; correction rules
// ---------------------------------------------------------------------------

test('a correction to a Top16 result before Quarterfinals starts changes the propagated winner', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16'); // p1 (A1) beats p2 (B8) on match 1
  const match1 = event.ko.top16.matches[0];
  assert.equal(match1.winnerPlayerId, match1.p1.playerId);

  // Correct match 1 so p2 (B8) wins instead, before Quarterfinals starts.
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 3, r2: 7 });
  assert.equal(event.ko.top16.matches[0].winnerPlayerId, event.ko.top16.matches[0].p2.playerId);

  event = startKoStage(event, 'quarterfinals');
  assert.equal(event.ko.quarterfinals.matches[0].p1.seed, 'B8');
});

test('prior-stage corrections are blocked once the next stage has started', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16');
  event = startKoStage(event, 'quarterfinals');
  assert.equal(canCorrectKoStage(event, 'top16'), false);
  assert.throws(() => recordKoResult(event, 'top16', { matchNumber: 1, r1: 3, r2: 7 }), /locked/);
});

test('recordKoResult rejects an invalid race-to-7 score at the event level', () => {
  let event = startTop16(readyForTop16());
  assert.throws(() => recordKoResult(event, 'top16', { matchNumber: 1, r1: 6, r2: 5 }), /invalid race-to-7/);
});

test('recordKoResult rejects an invalid race-to-9 Final score', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16');
  event = startKoStage(event, 'quarterfinals');
  event = winEveryMatch(event, 'quarterfinals');
  event = startKoStage(event, 'semifinals');
  event = winEveryMatch(event, 'semifinals');
  event = startKoStage(event, 'final');
  assert.throws(() => recordKoResult(event, 'final', { matchNumber: 1, r1: 9, r2: 9 }), /invalid race-to-9/);
  assert.throws(() => recordKoResult(event, 'final', { matchNumber: 1, r1: 10, r2: 2 }), /invalid race-to-9/);
});

// ---------------------------------------------------------------------------
// RESET / RECOVERY
// ---------------------------------------------------------------------------

test('resetKoStage removes only Quarterfinals and reopens completed Top16 for correction', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16');
  event = startKoStage(event, 'quarterfinals');
  assert.equal(getCurrentKoStage(event), 'quarterfinals');

  event = resetKoStage(event);
  assert.equal(event.ko.quarterfinals, null);
  assert.equal(event.ko.top16.matches.length, 8);
  assert.equal(canCorrectKoStage(event, 'top16'), true);
  assert.doesNotThrow(() => recordKoResult(event, 'top16', { matchNumber: 1, r1: 3, r2: 7 }));
});

test('resetKoStage removes only Semifinals and reopens Quarterfinals', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16');
  event = startKoStage(event, 'quarterfinals');
  event = winEveryMatch(event, 'quarterfinals');
  event = startKoStage(event, 'semifinals');

  event = resetKoStage(event);
  assert.equal(event.ko.semifinals, null);
  assert.equal(event.ko.quarterfinals.matches.length, 4);
  assert.equal(canCorrectKoStage(event, 'quarterfinals'), true);
});

test('resetKoStage removes only Final and reopens Semifinals', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16');
  event = startKoStage(event, 'quarterfinals');
  event = winEveryMatch(event, 'quarterfinals');
  event = startKoStage(event, 'semifinals');
  event = winEveryMatch(event, 'semifinals');
  event = startKoStage(event, 'final');

  event = resetKoStage(event);
  assert.equal(event.ko.final, null);
  assert.equal(getKoChampion(event), null);
  assert.equal(event.ko.semifinals.matches.length, 2);
  assert.equal(canCorrectKoStage(event, 'semifinals'), true);
});

test('resetKoStage never touches Block A/B locks, qualifiers, or tournament state', () => {
  let event = startTop16(readyForTop16());
  const blockALockBefore = event.blockALock;
  const blockBLockBefore = event.blockBLock;
  const blockATournamentBefore = event.blockA.tournament;
  const blockBTournamentBefore = event.blockB.tournament;

  event = resetKoStage(event);

  assert.equal(event.blockALock, blockALockBefore);
  assert.equal(event.blockBLock, blockBLockBefore);
  assert.equal(event.blockA.tournament, blockATournamentBefore);
  assert.equal(event.blockB.tournament, blockBTournamentBefore);
});

test('canResetKoStage is false with no KO stage started', () => {
  assert.equal(canResetKoStage(createCanalettoEvent()).ok, false);
});

// ---------------------------------------------------------------------------
// PERSISTENCE
// ---------------------------------------------------------------------------

test('JSON/localStorage round trip preserves the full KO bracket exactly, including champion', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16');
  event = startKoStage(event, 'quarterfinals');
  event = winEveryMatch(event, 'quarterfinals');
  event = startKoStage(event, 'semifinals');
  event = winEveryMatch(event, 'semifinals');
  event = startKoStage(event, 'final');
  event = recordKoResult(event, 'final', { matchNumber: 1, r1: 9, r2: 5 });

  const restored = JSON.parse(JSON.stringify(event));
  assert.deepEqual(restored, event);
  assert.deepEqual(validateCanalettoEvent(restored), { valid: true, errors: [] });
  assert.deepEqual(getKoChampion(restored), getKoChampion(event));
});

// ---------------------------------------------------------------------------
// CHAMPION
// ---------------------------------------------------------------------------

test('champion and runner-up are only present once the Final is complete', () => {
  let event = startTop16(readyForTop16());
  event = winEveryMatch(event, 'top16');
  event = startKoStage(event, 'quarterfinals');
  event = winEveryMatch(event, 'quarterfinals');
  event = startKoStage(event, 'semifinals');
  event = winEveryMatch(event, 'semifinals');
  event = startKoStage(event, 'final');
  assert.equal(getKoChampion(event), null);

  event = recordKoResult(event, 'final', { matchNumber: 1, r1: 9, r2: 2 });
  const champion = getKoChampion(event);
  assert.ok(champion.playerId);
  assert.ok(champion.runnerUpId);
  assert.notEqual(champion.playerId, champion.runnerUpId);
});
