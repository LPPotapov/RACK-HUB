import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPlayerToBlock,
  advanceBlockRound,
  assignBlockMatchTable,
  confirmBlockRoundTables,
  createCanalettoEvent,
  editBlockRoundTables,
  isRoundTablesConfirmed,
  lockBlock,
  recordBlockMatchResult,
  resetBlockCurrentRound,
  resetBlockTournament,
  startBlock,
  validateCanalettoEvent
} from '../src/application/canalettoEvent.js';

const rosterOf = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Player ${i + 1}`, elo: 1500 + (n - i) }));

const startedEvent = (n = 6) => {
  let event = createCanalettoEvent({ roundsPerBlock: 2, racksPerMatch: 8, qualificationThreshold: 4 });
  rosterOf(n).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  event = startBlock(event, 'A', { seedMethod: 'cross_elo' });
  return event;
};

test('a fresh event has no confirmed rounds for either block', () => {
  const event = createCanalettoEvent();
  assert.deepEqual(event.blockATableConfirmations, []);
  assert.deepEqual(event.blockBTableConfirmations, []);
  assert.equal(isRoundTablesConfirmed(event, 'A', 1), false);
});

test('confirmBlockRoundTables marks the round confirmed for that block only', () => {
  let event = startedEvent();
  event = confirmBlockRoundTables(event, 'A', 1);
  assert.equal(isRoundTablesConfirmed(event, 'A', 1), true);
  assert.equal(isRoundTablesConfirmed(event, 'A', 2), false);
  assert.equal(isRoundTablesConfirmed(event, 'B', 1), false); // other block untouched
});

test('confirmBlockRoundTables is idempotent (confirming twice does not duplicate)', () => {
  let event = startedEvent();
  event = confirmBlockRoundTables(event, 'A', 1);
  event = confirmBlockRoundTables(event, 'A', 1);
  assert.deepEqual(event.blockATableConfirmations, [1]);
});

test('confirmBlockRoundTables is refused on a locked block', () => {
  let event = startedEvent(6);
  event.blockA.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event = advanceBlockRound(event, 'A');
  event.blockA.tournament.rounds[2].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 2, matchId: m.id, r1: 5, r2: 3 });
  });
  event = lockBlock(event, 'A');
  assert.throws(() => confirmBlockRoundTables(event, 'A', 2), /locked/);
});

test('resetting the current round clears that round\'s confirmation (tables are regenerated, no longer what was confirmed)', () => {
  let event = startedEvent();
  event = confirmBlockRoundTables(event, 'A', 1);
  assert.equal(isRoundTablesConfirmed(event, 'A', 1), true);

  event = resetBlockCurrentRound(event, 'A');

  assert.equal(isRoundTablesConfirmed(event, 'A', 1), false);
});

test('resetting the block tournament clears all confirmations for that block', () => {
  let event = startedEvent();
  event = confirmBlockRoundTables(event, 'A', 1);
  event = resetBlockTournament(event, 'A');
  assert.deepEqual(event.blockATableConfirmations, []);
});

test('a table confirmations field is not required for a valid event (backward compatibility with already-saved state)', () => {
  const event = createCanalettoEvent();
  const { blockATableConfirmations, blockBTableConfirmations, ...withoutConfirmations } = event;
  const result = validateCanalettoEvent(withoutConfirmations);
  assert.equal(result.valid, true);
  assert.equal(isRoundTablesConfirmed(withoutConfirmations, 'A', 1), false);
});

test('confirmation state persists/reloads faithfully through JSON', () => {
  let event = startedEvent();
  event = confirmBlockRoundTables(event, 'A', 1);
  const restored = JSON.parse(JSON.stringify(event));
  assert.deepEqual(restored, event);
});

// ---------------------------------------------------------------------------
// Freeze on confirm / edit to unfreeze (follow-up correction)
// ---------------------------------------------------------------------------

test('a confirmed round\'s tables are frozen: assignBlockMatchTable refuses to change them', () => {
  let event = startedEvent();
  const match = event.blockA.tournament.rounds[1][0];
  event = confirmBlockRoundTables(event, 'A', 1);

  assert.throws(
    () => assignBlockMatchTable(event, 'A', { roundNumber: 1, matchId: match.id, table: '999' }),
    /confirmed and frozen/
  );
});

test('a NOT-yet-confirmed round remains editable (no change in existing behavior)', () => {
  let event = startedEvent();
  const match = event.blockA.tournament.rounds[1][0];
  event = assignBlockMatchTable(event, 'A', { roundNumber: 1, matchId: match.id, table: '301 TV' });
  const updated = event.blockA.tournament.rounds[1].find((m) => m.id === match.id);
  assert.equal(updated.tbl, '301 TV');
});

test('editBlockRoundTables un-confirms a round, unfreezing it and hiding it from All Rounds again', () => {
  let event = startedEvent();
  const match = event.blockA.tournament.rounds[1][0];
  event = confirmBlockRoundTables(event, 'A', 1);
  assert.equal(isRoundTablesConfirmed(event, 'A', 1), true);

  event = editBlockRoundTables(event, 'A', 1);

  assert.equal(isRoundTablesConfirmed(event, 'A', 1), false);
  // Unfrozen — editing now works again.
  event = assignBlockMatchTable(event, 'A', { roundNumber: 1, matchId: match.id, table: '404' });
  assert.equal(event.blockA.tournament.rounds[1].find((m) => m.id === match.id).tbl, '404');
});

test('a re-edited round must be explicitly re-confirmed — editing alone does not restore visibility', () => {
  let event = startedEvent();
  event = confirmBlockRoundTables(event, 'A', 1);
  event = editBlockRoundTables(event, 'A', 1);
  assert.equal(isRoundTablesConfirmed(event, 'A', 1), false);

  event = confirmBlockRoundTables(event, 'A', 1);
  assert.equal(isRoundTablesConfirmed(event, 'A', 1), true);
});

test('editBlockRoundTables is idempotent and refused on a locked block', () => {
  let event = startedEvent(6);
  event = confirmBlockRoundTables(event, 'A', 1);
  // Idempotent: editing an already-unconfirmed round is a no-op.
  event = editBlockRoundTables(event, 'A', 1);
  const again = editBlockRoundTables(event, 'A', 1);
  assert.deepEqual(again.blockATableConfirmations, event.blockATableConfirmations);

  event.blockA.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event = advanceBlockRound(event, 'A');
  event = confirmBlockRoundTables(event, 'A', 2);
  event.blockA.tournament.rounds[2].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 2, matchId: m.id, r1: 5, r2: 3 });
  });
  event = lockBlock(event, 'A');
  assert.throws(() => editBlockRoundTables(event, 'A', 2), /locked/);
});
