// Director correction pass: Top16 operational slots, estimated schedule,
// table-confirm/bracket consistency, and the KO Results/GBR calibration
// table. Complements tests/canaletto-ko.test.js, canaletto-ko-event.test.js,
// and canaletto-ko-gbr-characterization.test.js — this file targets ONLY
// what changed in this pass.

import assert from 'node:assert/strict';
import test from 'node:test';
import { gbrChange } from '../src/domain/fixedRackBbs.js';
import {
  KO_TOP16_SLOT_SIZE,
  koResultsStageLabel,
  top16SlotForMatch
} from '../src/application/canalettoKo.js';
import {
  addPlayerToBlock,
  assignKoTable,
  confirmKoTables,
  createCanalettoEvent,
  editKoTables,
  getKoResultsRows,
  lockBlock,
  recordBlockMatchResult,
  recordKoResult,
  setEventTables,
  startBlock,
  startKoStage,
  startTop16,
  updateCanalettoSchedule,
  validateCanalettoEvent
} from '../src/application/canalettoEvent.js';
import { formatScheduleRange, normalizeDateTimeLocalValue, parseEuDateTimeInputs, toEuDateInputValue, toEuTimeInputValue } from '../src/canaletto/schedule.js';

const rosterOf = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, name: `Player ${offset + i + 1}`, elo: 1500 + (n - i) }));
const tablesOf = (n) => Array.from({ length: n }, (_, i) => ({ order: i + 1, label: `Table ${i + 1}`, billardPadId: null, scoreLink: null }));

const readyForTop16 = (tableCount = 9) => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 8 });
  event = setEventTables(event, tablesOf(tableCount));
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

// ---------------------------------------------------------------------------
// TOP16 SLOTS
// ---------------------------------------------------------------------------

test('matches 1-4 belong to Slot 1, matches 5-8 belong to Slot 2', () => {
  assert.equal(top16SlotForMatch(1), 1);
  assert.equal(top16SlotForMatch(4), 1);
  assert.equal(top16SlotForMatch(5), 2);
  assert.equal(top16SlotForMatch(8), 2);
  assert.equal(KO_TOP16_SLOT_SIZE, 4);
});

test('both Top16 slots use only the first 4 configured tables (Slot 2 reuses Slot 1\'s tables, never tables 5-8)', () => {
  let event = startTop16(readyForTop16(9));
  const tbls = event.ko.top16.matches.map((m) => m.tbl);
  assert.deepEqual(tbls, ['Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 1', 'Table 2', 'Table 3', 'Table 4']);
  assert.ok(!tbls.includes('Table 5'));
});

test('Quarterfinals still waits for ALL 8 Top16 matches, regardless of slot grouping', () => {
  let event = startTop16(readyForTop16());
  // Complete all of Slot 1 (matches 1-4) only.
  event.ko.top16.matches.slice(0, 4).forEach((m) => {
    event = recordKoResult(event, 'top16', { matchNumber: m.matchNumber, r1: 7, r2: 0 });
  });
  assert.throws(() => startKoStage(event, 'quarterfinals'), /top16 is not complete/);
  // Complete Slot 2 as well.
  event.ko.top16.matches.slice(4, 8).forEach((m) => {
    event = recordKoResult(event, 'top16', { matchNumber: m.matchNumber, r1: 7, r2: 0 });
  });
  assert.doesNotThrow(() => startKoStage(event, 'quarterfinals'));
});

test('bracket propagation is unchanged by the slot split: QF1 is still winner(M1) v winner(M2)', () => {
  let event = startTop16(readyForTop16());
  event.ko.top16.matches.forEach((m) => {
    event = recordKoResult(event, 'top16', { matchNumber: m.matchNumber, r1: 7, r2: 0 }); // p1 always wins
  });
  event = startKoStage(event, 'quarterfinals');
  assert.equal(event.ko.quarterfinals.matches[0].p1.seed, 'A1');
  assert.equal(event.ko.quarterfinals.matches[0].p2.seed, 'B1');
});

// ---------------------------------------------------------------------------
// SCHEDULE
// ---------------------------------------------------------------------------

test('all 7 schedule groups exist by default with blank optional values', () => {
  const event = createCanalettoEvent();
  ['blockA', 'blockB', 'top16Slot1', 'top16Slot2', 'quarterfinals', 'semifinals', 'final'].forEach((key) => {
    assert.deepEqual(event.schedule[key], { start: '', end: '' });
  });
});

test('updateCanalettoSchedule sets one group without touching the others', () => {
  let event = createCanalettoEvent();
  event = updateCanalettoSchedule(event, 'top16Slot1', { start: '2026-08-14T18:00', end: '2026-08-14T19:00' });
  assert.deepEqual(event.schedule.top16Slot1, { start: '2026-08-14T18:00', end: '2026-08-14T19:00' });
  assert.deepEqual(event.schedule.top16Slot2, { start: '', end: '' });
  assert.deepEqual(event.schedule.blockA, { start: '', end: '' });
});

test('updateCanalettoSchedule rejects an unknown schedule key', () => {
  assert.throws(() => updateCanalettoSchedule(createCanalettoEvent(), 'bogus', { start: '2026-01-01T10:00', end: '' }), /invalid schedule key/);
});

test('blank schedule values remain valid', () => {
  const event = updateCanalettoSchedule(createCanalettoEvent(), 'final', { start: '', end: '' });
  assert.deepEqual(validateCanalettoEvent(event), { valid: true, errors: [] });
});

test('schedule persists through JSON/localStorage round trip', () => {
  let event = updateCanalettoSchedule(createCanalettoEvent(), 'quarterfinals', { start: '2026-08-15T10:00', end: '2026-08-15T11:00' });
  event = updateCanalettoSchedule(event, 'final', { start: '2026-08-16T14:00', end: '' });
  const restored = JSON.parse(JSON.stringify(event));
  assert.deepEqual(restored.schedule, event.schedule);
  assert.deepEqual(validateCanalettoEvent(restored), { valid: true, errors: [] });
});

test('formatScheduleRange renders European DD.MM.YYYY · 24h HH:MM and returns null for unset/blank', () => {
  assert.equal(formatScheduleRange({ start: '2026-08-14T18:00', end: '2026-08-14T19:00' }), '14.08.2026 · 18:00–19:00');
  assert.equal(formatScheduleRange({ start: '2026-08-14T18:00', end: '' }), '14.08.2026 · 18:00');
  assert.equal(formatScheduleRange({ start: '2026-08-14T21:00', end: '' }).includes('PM'), false);
  assert.equal(formatScheduleRange({ start: '', end: '' }), null);
  assert.equal(formatScheduleRange(undefined), null);
});

test('formatScheduleRange never emits AM/PM, at any hour of the day (00-23)', () => {
  for (let hour = 0; hour < 24; hour++) {
    const hh = String(hour).padStart(2, '0');
    const rendered = formatScheduleRange({ start: `2026-08-14T${hh}:00`, end: '' });
    assert.equal(rendered, `14.08.2026 · ${hh}:00`);
    assert.ok(!/am|pm/i.test(rendered));
  }
});

test('formatScheduleRange uses DD.MM.YYYY, not US MM/DD/YYYY, order', () => {
  // 14th of August — if this were misread as month=14 it would be invalid;
  // asserting the exact rendered string proves day-then-month ordering.
  assert.equal(formatScheduleRange({ start: '2026-08-14T09:05', end: '' }), '14.08.2026 · 09:05');
  assert.equal(formatScheduleRange({ start: '2026-01-31T09:05', end: '' }), '31.01.2026 · 09:05');
});

test('Block A / Block B schedule display data: formatScheduleRange reads event.schedule.blockA/blockB correctly', () => {
  let event = updateCanalettoSchedule(createCanalettoEvent(), 'blockA', { start: '2026-08-14T18:00', end: '2026-08-14T23:00' });
  event = updateCanalettoSchedule(event, 'blockB', { start: '2026-08-15T09:00', end: '2026-08-15T14:00' });
  assert.equal(formatScheduleRange(event.schedule.blockA), '14.08.2026 · 18:00–23:00');
  assert.equal(formatScheduleRange(event.schedule.blockB), '15.08.2026 · 09:00–14:00');
});

test('normalizeDateTimeLocalValue defaults a bare hour-only value to :00 minutes', () => {
  assert.equal(normalizeDateTimeLocalValue('2026-08-14T18'), '2026-08-14T18:00');
  assert.equal(normalizeDateTimeLocalValue('2026-08-14T09'), '2026-08-14T09:00');
});

test('normalizeDateTimeLocalValue preserves an explicit, non-zero minute value unchanged', () => {
  assert.equal(normalizeDateTimeLocalValue('2026-08-14T18:15'), '2026-08-14T18:15');
  assert.equal(normalizeDateTimeLocalValue('2026-08-14T19:30'), '2026-08-14T19:30');
});

test('normalizeDateTimeLocalValue passes through an empty value and an already-complete :00 value unchanged', () => {
  assert.equal(normalizeDateTimeLocalValue(''), '');
  assert.equal(normalizeDateTimeLocalValue('2026-08-14T10:00'), '2026-08-14T10:00');
});

// ---------------------------------------------------------------------------
// EU-FORMATTED SCHEDULE INPUT FIELDS (director correction — item 1 also
// applies to the schedule INPUT widgets, not just the read-only display; a
// native datetime-local input's widget renders in US format on a US-locale
// machine regardless of its stored value, so EventPage.jsx now uses plain
// DD.MM.YYYY / HH:MM text fields instead — these are the parsing/formatting
// helpers behind them).
// ---------------------------------------------------------------------------

test('toEuDateInputValue / toEuTimeInputValue render the stored ISO value as DD.MM.YYYY / HH:MM', () => {
  assert.equal(toEuDateInputValue('2026-08-14T18:00'), '14.08.2026');
  assert.equal(toEuTimeInputValue('2026-08-14T18:00'), '18:00');
  assert.equal(toEuDateInputValue(''), '');
  assert.equal(toEuTimeInputValue(''), '');
});

test('parseEuDateTimeInputs converts DD.MM.YYYY + HH:MM to the internal ISO value', () => {
  assert.equal(parseEuDateTimeInputs('14.08.2026', '18:00'), '2026-08-14T18:00');
  assert.equal(parseEuDateTimeInputs('31.01.2026', '09:05'), '2026-01-31T09:05');
});

test('parseEuDateTimeInputs defaults a blank time to :00 (docs task item 2)', () => {
  assert.equal(parseEuDateTimeInputs('14.08.2026', ''), '2026-08-14T00:00');
});

test('parseEuDateTimeInputs preserves an explicit non-zero minute unchanged', () => {
  assert.equal(parseEuDateTimeInputs('14.08.2026', '18:15'), '2026-08-14T18:15');
});

test('parseEuDateTimeInputs returns \'\' only when BOTH fields are blank (matches the unset convention)', () => {
  assert.equal(parseEuDateTimeInputs('', ''), '');
  assert.equal(parseEuDateTimeInputs('  ', ''), '');
});

test('parseEuDateTimeInputs returns null (not a fabricated value) for a partial/invalid date, so the caller does not commit it', () => {
  assert.equal(parseEuDateTimeInputs('14.08.20', ''), null); // incomplete year
  assert.equal(parseEuDateTimeInputs('14.8.2026', ''), null); // must be zero-padded DD.MM.YYYY
  assert.equal(parseEuDateTimeInputs('32.01.2026', ''), null); // invalid day
  assert.equal(parseEuDateTimeInputs('14.13.2026', ''), null); // invalid month
});

test('parseEuDateTimeInputs returns null for a malformed (non-blank) time rather than silently guessing', () => {
  assert.equal(parseEuDateTimeInputs('14.08.2026', '25:00'), null); // invalid hour
  assert.equal(parseEuDateTimeInputs('14.08.2026', '18:75'), null); // invalid minute
  assert.equal(parseEuDateTimeInputs('14.08.2026', 'abc'), null);
});

test('a value round-trips through toEu*/parseEu* unchanged', () => {
  const iso = '2026-08-14T18:00';
  const roundTripped = parseEuDateTimeInputs(toEuDateInputValue(iso), toEuTimeInputValue(iso));
  assert.equal(roundTripped, iso);
});

test('the EU input helpers never produce or accept US MM/DD/YYYY or 12-hour AM/PM formats', () => {
  assert.equal(parseEuDateTimeInputs('08/14/2026', '6:00 PM'), null);
  assert.ok(!toEuDateInputValue('2026-08-14T18:00').includes('/'));
  assert.ok(!toEuTimeInputValue('2026-08-14T18:00').match(/am|pm/i));
});

// ---------------------------------------------------------------------------
// TABLE CONFIRM — bracket and operational cards share the same source
// ---------------------------------------------------------------------------

test('assignKoTable\'s table value is immediately what the bracket would read (same match.tbl field)', () => {
  let event = startTop16(readyForTop16());
  event = assignKoTable(event, 'top16', { matchNumber: 1, table: 'Table 9' });
  assert.equal(event.ko.top16.matches[0].tbl, 'Table 9'); // the exact field BracketNode reads
});

test('confirmKoTables freezes tablesConfirmed for the WHOLE Top16 stage (chosen model: one flag, both slots)', () => {
  let event = startTop16(readyForTop16());
  event = confirmKoTables(event, 'top16');
  assert.equal(event.ko.top16.tablesConfirmed, true);
  // Applies to a Slot 2 match too, not just Slot 1 — same single flag.
  assert.throws(() => assignKoTable(event, 'top16', { matchNumber: 6, table: 'Table 9' }), /confirmed and frozen/);
  event = editKoTables(event, 'top16');
  assert.equal(event.ko.top16.tablesConfirmed, false);
  event = assignKoTable(event, 'top16', { matchNumber: 6, table: 'Table 9' });
  assert.equal(event.ko.top16.matches[5].tbl, 'Table 9');
});

test('table-confirm state (both Top16 slots) round-trips through JSON/localStorage', () => {
  let event = startTop16(readyForTop16());
  event = confirmKoTables(event, 'top16');
  const restored = JSON.parse(JSON.stringify(event));
  assert.equal(restored.ko.top16.tablesConfirmed, true);
  assert.deepEqual(restored.ko.top16.matches.map((m) => m.tbl), event.ko.top16.matches.map((m) => m.tbl));
});

// ---------------------------------------------------------------------------
// BRACKET — frozen GBR / race target / score-to-player mapping
// ---------------------------------------------------------------------------

test('bracket-relevant match fields expose frozen GBR from the match snapshot, unaffected by later stage generation', () => {
  let event = startTop16(readyForTop16());
  const beforeP1Gbr = event.ko.top16.matches[0].p1.gbr;
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 3 });
  assert.equal(event.ko.top16.matches[0].p1.gbr, beforeP1Gbr); // still the frozen pre-match value
});

test('completing a match does not alter its own bracket-displayed pre-match GBR', () => {
  let event = startTop16(readyForTop16());
  const snapshot = { p1: event.ko.top16.matches[0].p1.gbr, p2: event.ko.top16.matches[0].p2.gbr };
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 3 });
  assert.equal(event.ko.top16.matches[0].p1.gbr, snapshot.p1);
  assert.equal(event.ko.top16.matches[0].p2.gbr, snapshot.p2);
});

test('every KO stage exposes its correct race target (Top16/QF/SF = 7, Final = 9)', () => {
  let event = startTop16(readyForTop16());
  event.ko.top16.matches.forEach((m) => { event = recordKoResult(event, 'top16', { matchNumber: m.matchNumber, r1: 7, r2: 0 }); });
  event = startKoStage(event, 'quarterfinals');
  event.ko.quarterfinals.matches.forEach((m) => { event = recordKoResult(event, 'quarterfinals', { matchNumber: m.matchNumber, r1: 7, r2: 0 }); });
  event = startKoStage(event, 'semifinals');
  event.ko.semifinals.matches.forEach((m) => { event = recordKoResult(event, 'semifinals', { matchNumber: m.matchNumber, r1: 7, r2: 0 }); });
  event = startKoStage(event, 'final');

  const rows = getKoResultsRows(event);
  assert.ok(rows.filter((r) => r.stage === 'top16').every((r) => r.target === 7));
  assert.ok(rows.filter((r) => r.stage === 'quarterfinals').every((r) => r.target === 7));
  assert.ok(rows.filter((r) => r.stage === 'semifinals').every((r) => r.target === 7));
  assert.ok(rows.filter((r) => r.stage === 'final').every((r) => r.target === 9));
});

test('recorded scores map to the correct player (winner determined by r1 > r2 against p1, not by name/order)', () => {
  let event = startTop16(readyForTop16());
  const m = event.ko.top16.matches[0];
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 3, r2: 7 }); // p2 wins
  const updated = event.ko.top16.matches[0];
  assert.equal(updated.winnerPlayerId, m.p2.playerId);
  assert.equal(updated.r1, 3);
  assert.equal(updated.r2, 7);
});

// ---------------------------------------------------------------------------
// KO RESULTS — every generated match, correct slot labels, PRE/POST GBR, ΔGBR
// ---------------------------------------------------------------------------

test('KO Results contains every generated match across all started stages', () => {
  let event = startTop16(readyForTop16());
  assert.equal(getKoResultsRows(event).length, 8);
  event.ko.top16.matches.forEach((m) => { event = recordKoResult(event, 'top16', { matchNumber: m.matchNumber, r1: 7, r2: 0 }); });
  event = startKoStage(event, 'quarterfinals');
  assert.equal(getKoResultsRows(event).length, 12); // 8 top16 + 4 QF
});

test('Top16 rows carry the correct SLOT 1 / SLOT 2 stage label', () => {
  const event = startTop16(readyForTop16());
  const rows = getKoResultsRows(event);
  assert.deepEqual(rows.slice(0, 4).map((r) => r.stageLabel), ['TOP16 SLOT 1', 'TOP16 SLOT 1', 'TOP16 SLOT 1', 'TOP16 SLOT 1']);
  assert.deepEqual(rows.slice(4, 8).map((r) => r.stageLabel), ['TOP16 SLOT 2', 'TOP16 SLOT 2', 'TOP16 SLOT 2', 'TOP16 SLOT 2']);
  assert.equal(koResultsStageLabel('quarterfinals', 1), 'QUARTERFINALS');
  assert.equal(koResultsStageLabel('final', 1), 'FINAL');
});

test('PRE GBR/POST GBR/RAW Δ/APPLIED Δ are exactly the match\'s own stored values, symmetric between playerA and playerB', () => {
  let event = startTop16(readyForTop16());
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 4 });
  const match = event.ko.top16.matches[0];
  const row = getKoResultsRows(event).find((r) => r.stage === 'top16' && r.matchNumber === 1);
  assert.equal(row.playerA.preGbr, match.p1.gbr);
  assert.equal(row.playerB.preGbr, match.p2.gbr);
  assert.equal(row.playerA.postGbr, match.p1PostGbr);
  assert.equal(row.playerB.postGbr, match.p2PostGbr);
  assert.equal(row.playerA.rawDelta, match.rawDelta);
  assert.equal(row.playerB.rawDelta, -match.rawDelta);
  assert.equal(row.playerA.appliedDelta, match.appliedDelta);
  assert.equal(row.playerB.appliedDelta, -match.appliedDelta);
  // Same field set, same order, on both sides — the symmetry requirement.
  assert.deepEqual(Object.keys(row.playerA), Object.keys(row.playerB));
});

test('an undone match reports null POST/RAW Δ/APPLIED Δ fields (no fabricated value), but PRE GBR is always known', () => {
  const event = startTop16(readyForTop16());
  const row = getKoResultsRows(event)[0];
  assert.equal(row.done, false);
  assert.equal(typeof row.playerA.preGbr, 'number');
  assert.equal(row.playerA.postGbr, null);
  assert.equal(row.playerA.rawDelta, null);
  assert.equal(row.playerA.appliedDelta, null);
  assert.equal(row.playerB.postGbr, null);
  assert.equal(row.playerB.rawDelta, null);
  assert.equal(row.playerB.appliedDelta, null);
});

test('whole-number rounding is a DISPLAY concern only — buildKoResultsRows itself keeps full float precision', () => {
  let event = startTop16(readyForTop16());
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 4 });
  const row = getKoResultsRows(event).find((r) => r.stage === 'top16' && r.matchNumber === 1);
  // Not asserting a specific fractional value (formula is exercised in
  // canaletto-ko-gbr-characterization.test.js) — only that this function
  // does not itself round.
  assert.equal(typeof row.playerA.rawDelta, 'number');
  assert.equal(typeof row.playerA.appliedDelta, 'number');
});

// ---------------------------------------------------------------------------
// ZERO-SUM CHARACTERIZATION (via the KO Results table's own derived rows) —
// both RAW and APPLIED must independently be zero-sum (docs task item 27).
// ---------------------------------------------------------------------------

test('for every completed KO match, RAW Δ A + RAW Δ B ≈ 0 AND APPLIED Δ A + APPLIED Δ B ≈ 0', () => {
  let event = startTop16(readyForTop16());
  const scores = [[7, 0], [7, 3], [7, 6], [6, 7], [3, 7], [0, 7], [7, 1], [1, 7]];
  event.ko.top16.matches.forEach((m, i) => {
    const [r1, r2] = scores[i];
    event = recordKoResult(event, 'top16', { matchNumber: m.matchNumber, r1, r2 });
  });
  const rows = getKoResultsRows(event);
  assert.equal(rows.length, 8);
  rows.forEach((r) => {
    assert.ok(Math.abs(r.playerA.rawDelta + r.playerB.rawDelta) < 1e-9, `raw zero-sum failed: ${r.playerA.rawDelta} + ${r.playerB.rawDelta}`);
    assert.ok(Math.abs(r.playerA.appliedDelta + r.playerB.appliedDelta) < 1e-9, `applied zero-sum failed: ${r.playerA.appliedDelta} + ${r.playerB.appliedDelta}`);
  });
});

test('this pass applies no new GBR formula to the RAW calculation: match.rawDelta still equals gbrChange() directly', () => {
  let event = startTop16(readyForTop16());
  const before = event.ko.top16.matches[0];
  const gbrConfig = event.blockA.tournament.config;
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 5 });
  const after = event.ko.top16.matches[0];
  assert.ok(Math.abs(after.rawDelta - gbrChange(before.p1.gbr, before.p2.gbr, 7, 5, gbrConfig)) < 1e-9);
});
