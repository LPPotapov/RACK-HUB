import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPlayerToBlock,
  assignKoTable,
  confirmKoTables,
  createCanalettoEvent,
  getKoGbrWeight,
  lockBlock,
  recordBlockMatchResult,
  recordKoResult,
  setEventTables,
  startBlock,
  startTop16,
  updateKoGbrWeight,
  validateCanalettoEvent
} from '../src/application/canalettoEvent.js';
import { createCanalettoLiveState, selectTvMatch, setTvScore } from '../src/application/canalettoLive.js';
import {
  buildBackupFilename,
  CANALETTO_BACKUP_TYPE,
  CANALETTO_BACKUP_VERSION,
  createCanalettoBackup,
  restoreCanalettoEvent,
  validateCanalettoBackup
} from '../src/application/canalettoBackup.js';

const rosterOf = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, name: `Player ${offset + i + 1}`, elo: 1500 + (n - i) }));
const tablesOf = (n) => Array.from({ length: n }, (_, i) => ({ order: i + 1, label: `Table ${i + 1}`, billardPadId: `bp-${i + 1}`, scoreLink: `https://example.test/${i + 1}` }));

// A rich fixture: both blocks played/locked, Top16 generated with one
// recorded/table-assigned result, a non-default KO GBR weight — enough
// surface area to prove a backup/restore round trip preserves everything
// the docs task lists (rounds, results, table assignments/confirmation,
// locks, qualifiers, KO stage/results/table/GBR-weight).
const richEvent = () => {
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
  event = startTop16(event);
  event = updateKoGbrWeight(event, 0.75);
  const firstMatch = event.ko.top16.matches[0];
  event = assignKoTable(event, 'top16', { matchNumber: firstMatch.matchNumber, table: 'Table 1' });
  event = confirmKoTables(event, 'top16');
  event = recordKoResult(event, 'top16', { matchNumber: firstMatch.matchNumber, r1: 7, r2: 2 });
  return event;
};

// ---------------------------------------------------------------------------
// createCanalettoBackup — full event regardless of `source`
// ---------------------------------------------------------------------------

test('backup contains the full CanalettoEvent, not just the currently-visible block/table', () => {
  const event = richEvent();
  const backup = createCanalettoBackup(event, { source: 'blockA' });
  assert.deepEqual(backup.event, event);
});

test('a Block A save includes Block B and KO state', () => {
  const event = richEvent();
  const backup = createCanalettoBackup(event, { source: 'blockA' });
  assert.ok(backup.event.blockB.tournament.rounds[1].length > 0);
  assert.ok(backup.event.ko.top16);
});

test('a Block B save includes Block A and KO state', () => {
  const event = richEvent();
  const backup = createCanalettoBackup(event, { source: 'blockB' });
  assert.ok(backup.event.blockA.tournament.rounds[1].length > 0);
  assert.ok(backup.event.ko.top16);
});

test('a KO-page save includes both blocks', () => {
  const event = richEvent();
  const backup = createCanalettoBackup(event, { source: 'ko' });
  assert.ok(backup.event.blockA.tournament.rounds[1].length > 0);
  assert.ok(backup.event.blockB.tournament.rounds[1].length > 0);
});

test('backup envelope has the documented shape', () => {
  const event = richEvent();
  const backup = createCanalettoBackup(event, { source: 'event' });
  assert.equal(backup.backupType, CANALETTO_BACKUP_TYPE);
  assert.equal(backup.backupVersion, CANALETTO_BACKUP_VERSION);
  assert.equal(backup.source, 'event');
  assert.equal(typeof backup.exportedAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(backup.exportedAt)));
});

test('backup optionally includes liveState (TV selection / manual stream score) when supplied', () => {
  const event = richEvent();
  let liveState = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: event.ko.top16.matches[1].matchNumber });
  liveState = setTvScore(liveState, { r1: 3, r2: 1 });
  const backup = createCanalettoBackup(event, { source: 'event', liveState });
  assert.deepEqual(backup.liveState, liveState);
});

test('createCanalettoBackup does not mutate the source event', () => {
  const event = richEvent();
  const frozen = JSON.parse(JSON.stringify(event));
  createCanalettoBackup(event, { source: 'event' });
  assert.deepEqual(event, frozen);
});

// ---------------------------------------------------------------------------
// JSON round trip
// ---------------------------------------------------------------------------

test('backup JSON round trip preserves the authoritative event exactly', () => {
  const event = richEvent();
  const backup = createCanalettoBackup(event, { source: 'event' });
  const roundTripped = JSON.parse(JSON.stringify(backup));
  assert.deepEqual(roundTripped.event, event);
});

test('restored event can be serialized again successfully (still a valid CanalettoEvent)', () => {
  const event = richEvent();
  const backup = JSON.parse(JSON.stringify(createCanalettoBackup(event, { source: 'event' })));
  const restored = restoreCanalettoEvent(createCanalettoEvent(), backup.event);
  const reserialized = JSON.parse(JSON.stringify(restored));
  assert.equal(validateCanalettoEvent(reserialized).valid, true);
});

// ---------------------------------------------------------------------------
// validateCanalettoBackup — reject cleanly, never partially apply
// ---------------------------------------------------------------------------

test('malformed (non-object / unparsable-shape) backup is rejected', () => {
  assert.equal(validateCanalettoBackup(null).valid, false);
  assert.equal(validateCanalettoBackup('not an object').valid, false);
  assert.equal(validateCanalettoBackup([]).valid, false);
  assert.equal(validateCanalettoBackup({}).valid, false);
});

test('wrong backupType is rejected', () => {
  const event = richEvent();
  const backup = createCanalettoBackup(event, { source: 'event' });
  const tampered = { ...backup, backupType: 'some-other-app-export' };
  const result = validateCanalettoBackup(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('backupType')));
});

test('unsupported backupVersion is rejected', () => {
  const event = richEvent();
  const backup = createCanalettoBackup(event, { source: 'event' });
  const tampered = { ...backup, backupVersion: 999 };
  const result = validateCanalettoBackup(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('backupVersion')));
});

test('a backup whose event fails structural validation is rejected', () => {
  const event = richEvent();
  const backup = createCanalettoBackup(event, { source: 'event' });
  const tampered = { ...backup, event: { not: 'a real event' } };
  const result = validateCanalettoBackup(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.startsWith('event:')));
});

test('a backup with a malformed liveState is rejected even if the event itself is fine', () => {
  const event = richEvent();
  const backup = createCanalettoBackup(event, { source: 'event' });
  const tampered = { ...backup, liveState: { tvMatch: { source: 'nope' }, tvScores: {} } };
  const result = validateCanalettoBackup(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.startsWith('liveState:')));
});

test('a well-formed backup validates successfully', () => {
  const event = richEvent();
  const backup = JSON.parse(JSON.stringify(createCanalettoBackup(event, { source: 'blockA' })));
  assert.equal(validateCanalettoBackup(backup).valid, true);
});

// ---------------------------------------------------------------------------
// restoreCanalettoEvent — REPLACE, never merge; preserves everything
// ---------------------------------------------------------------------------

test('restore replaces the current event rather than merging with it', () => {
  const backedUpEvent = richEvent();
  const currentEvent = createCanalettoEvent(); // an unrelated, freshly-created event
  const restored = restoreCanalettoEvent(currentEvent, backedUpEvent);
  assert.deepEqual(restored, backedUpEvent);
  // Nothing from currentEvent leaked into the result.
  assert.notDeepEqual(restored, currentEvent);
});

test('restore preserves rounds, results, table assignments/confirmation, block locks, and frozen qualifiers', () => {
  const backedUpEvent = richEvent();
  const restored = restoreCanalettoEvent(createCanalettoEvent(), backedUpEvent);
  assert.deepEqual(restored.blockA.tournament.rounds, backedUpEvent.blockA.tournament.rounds);
  assert.deepEqual(restored.blockATableConfirmations, backedUpEvent.blockATableConfirmations);
  assert.deepEqual(restored.blockALock, backedUpEvent.blockALock);
  assert.deepEqual(restored.blockBLock, backedUpEvent.blockBLock);
  assert.ok(restored.blockALock.qualifiers.length > 0);
});

test('restore preserves KO stages/results/table assignment and the configured KO GBR weight', () => {
  const backedUpEvent = richEvent();
  const restored = restoreCanalettoEvent(createCanalettoEvent(), backedUpEvent);
  assert.deepEqual(restored.ko.top16, backedUpEvent.ko.top16);
  assert.equal(getKoGbrWeight(restored), getKoGbrWeight(backedUpEvent));
  assert.equal(getKoGbrWeight(restored), 0.75);
  const restoredMatch = restored.ko.top16.matches.find((m) => m.done);
  assert.ok(restoredMatch);
  assert.equal(restoredMatch.tbl, 'Table 1');
  assert.equal(restoredMatch.r1, 7);
  assert.equal(restoredMatch.r2, 2);
});

test('restoreCanalettoEvent rejects a structurally invalid backup event (defense in depth)', () => {
  assert.throws(
    () => restoreCanalettoEvent(createCanalettoEvent(), { not: 'a real event' }),
    /failed validation/
  );
});

test('restoreCanalettoEvent never reads or depends on the currently-open event', () => {
  const backedUpEvent = richEvent();
  const oneCurrent = createCanalettoEvent();
  const differentCurrent = richEvent();
  assert.deepEqual(
    restoreCanalettoEvent(oneCurrent, backedUpEvent),
    restoreCanalettoEvent(differentCurrent, backedUpEvent)
  );
});

// ---------------------------------------------------------------------------
// buildBackupFilename
// ---------------------------------------------------------------------------

test('buildBackupFilename produces a human-readable, colon-free, sortable filename', () => {
  const name = buildBackupFilename('Canaletto Cup 2026', new Date(2026, 7, 14, 18, 45)); // month is 0-indexed: 7 = August
  assert.equal(name, 'canaletto-cup-2026-backup-2026-08-14-1845.json');
  assert.ok(!name.includes(':'));
});

test('buildBackupFilename falls back to a safe name when the event has no title', () => {
  const name = buildBackupFilename('', new Date(2026, 0, 1, 9, 5));
  assert.equal(name, 'canaletto-event-backup-2026-01-01-0905.json');
});

test('buildBackupFilename slugifies special characters out of the event title', () => {
  const name = buildBackupFilename('Canaletto Cup — 2026 (Finals!)', new Date(2026, 0, 1, 0, 0));
  assert.ok(/^[a-z0-9-]+\.json$/.test(name));
});
