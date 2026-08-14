// Director correction pass: the bracket must show the FULL Top16/QF/SF/Final
// tree structure at all times, with future slots as lightweight "source
// label" previews (e.g. "WINNER M1") — never fake/generic "TBD" match
// objects, and NEVER generated QF/SF/Final match state before the director
// explicitly starts that stage.

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBracketProjection } from '../src/application/canalettoKo.js';
import {
  addPlayerToBlock,
  createCanalettoEvent,
  getBracketProjection,
  getTop16Seeding,
  lockBlock,
  recordBlockMatchResult,
  recordKoResult,
  setEventTables,
  startBlock,
  startKoStage,
  startTop16
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

// ---------------------------------------------------------------------------
// Full structure exists before later stages are generated
// ---------------------------------------------------------------------------

test('the full Top16/QF/SF/Final structure exists even before Block A/B are locked', () => {
  const event = createCanalettoEvent();
  const projection = getBracketProjection(event);
  assert.equal(projection.top16.length, 8);
  assert.equal(projection.quarterfinals.length, 4);
  assert.equal(projection.semifinals.length, 2);
  assert.equal(projection.final.length, 1);
});

test('before Top16 has started, QF/SF/Final are all non-real projected slots', () => {
  const event = readyForTop16();
  const projection = getBracketProjection(event);
  assert.equal(projection.top16.every((s) => !s.real), true); // Top16 also not generated yet
  assert.equal(projection.quarterfinals.every((s) => !s.real), true);
  assert.equal(projection.semifinals.every((s) => !s.real), true);
  assert.equal(projection.final.every((s) => !s.real), true);
});

test('once Top16 starts, its slots become real matches while QF/SF/Final remain projected', () => {
  const event = startTop16(readyForTop16());
  const projection = getBracketProjection(event);
  assert.equal(projection.top16.every((s) => s.real), true);
  assert.equal(projection.top16[0].match.matchNumber, 1);
  assert.equal(projection.quarterfinals.every((s) => !s.real), true);
});

// ---------------------------------------------------------------------------
// Future slots have SOURCE LABELS, not fake match objects
// ---------------------------------------------------------------------------

test('unstarted QF slots show WINNER M1..M8 source labels, never a fake match object', () => {
  const event = startTop16(readyForTop16());
  const projection = getBracketProjection(event);
  assert.deepEqual(projection.quarterfinals.map((s) => s.match), [null, null, null, null]);
  assert.equal(projection.quarterfinals[0].top.known, false);
  assert.equal(projection.quarterfinals[0].top.sourceLabel, 'WINNER M1');
  assert.equal(projection.quarterfinals[0].bottom.sourceLabel, 'WINNER M2');
  assert.equal(projection.quarterfinals[1].top.sourceLabel, 'WINNER M3');
  assert.equal(projection.quarterfinals[1].bottom.sourceLabel, 'WINNER M4');
  assert.equal(projection.quarterfinals[2].top.sourceLabel, 'WINNER M5');
  assert.equal(projection.quarterfinals[2].bottom.sourceLabel, 'WINNER M6');
  assert.equal(projection.quarterfinals[3].top.sourceLabel, 'WINNER M7');
  assert.equal(projection.quarterfinals[3].bottom.sourceLabel, 'WINNER M8');
});

test('unstarted SF slots show WINNER QF1..QF4 source labels', () => {
  const event = startTop16(readyForTop16());
  const projection = getBracketProjection(event);
  assert.equal(projection.semifinals[0].top.sourceLabel, 'WINNER QF1');
  assert.equal(projection.semifinals[0].bottom.sourceLabel, 'WINNER QF2');
  assert.equal(projection.semifinals[1].top.sourceLabel, 'WINNER QF3');
  assert.equal(projection.semifinals[1].bottom.sourceLabel, 'WINNER QF4');
});

test('unstarted Final slot shows WINNER SF1 / WINNER SF2 source labels', () => {
  const event = startTop16(readyForTop16());
  const projection = getBracketProjection(event);
  assert.equal(projection.final[0].top.sourceLabel, 'WINNER SF1');
  assert.equal(projection.final[0].bottom.sourceLabel, 'WINNER SF2');
});

test('before either block is locked, Top16 slots show "Awaiting Block A/B" source labels, not generic TBD', () => {
  const event = createCanalettoEvent();
  const projection = getBracketProjection(event);
  assert.equal(projection.top16[0].top.known, false);
  assert.ok(projection.top16[0].top.sourceLabel.startsWith('Awaiting Block'));
});

// ---------------------------------------------------------------------------
// Progressive population: M1 winner -> QF1 first participant, M2 -> second
// ---------------------------------------------------------------------------

test('M1 winner populates QF1\'s first (top) participant as soon as M1 is done, before QF starts', () => {
  let event = startTop16(readyForTop16());
  const m1 = event.ko.top16.matches[0];
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 3 }); // p1 wins
  const projection = getBracketProjection(event);
  assert.equal(projection.quarterfinals[0].top.known, true);
  assert.equal(projection.quarterfinals[0].top.playerId, m1.p1.playerId);
  assert.equal(projection.quarterfinals[0].bottom.known, false);
  assert.equal(projection.quarterfinals[0].bottom.sourceLabel, 'WINNER M2');
});

test('M2 winner populates QF1\'s second (bottom) participant', () => {
  let event = startTop16(readyForTop16());
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 3 });
  const m2 = event.ko.top16.matches[1];
  event = recordKoResult(event, 'top16', { matchNumber: 2, r1: 3, r2: 7 }); // p2 wins
  const projection = getBracketProjection(event);
  assert.equal(projection.quarterfinals[0].top.known, true);
  assert.equal(projection.quarterfinals[0].bottom.known, true);
  assert.equal(projection.quarterfinals[0].bottom.playerId, m2.p2.playerId);
});

test('future participant population does NOT generate QF state', () => {
  let event = startTop16(readyForTop16());
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 3 });
  event = recordKoResult(event, 'top16', { matchNumber: 2, r1: 3, r2: 7 });
  // Even with all of Top16 potentially playable, QF must remain ungenerated
  // until the director explicitly starts it.
  assert.equal(event.ko.quarterfinals, null);
});

test('SF and Final behave equivalently: QF winners populate SF preview without SF being generated', () => {
  let event = startTop16(readyForTop16());
  event.ko.top16.matches.forEach((m) => { event = recordKoResult(event, 'top16', { matchNumber: m.matchNumber, r1: 7, r2: 0 }); });
  event = startKoStage(event, 'quarterfinals');
  const qf1 = event.ko.quarterfinals.matches[0];
  event = recordKoResult(event, 'quarterfinals', { matchNumber: 1, r1: 7, r2: 2 });

  const projection = getBracketProjection(event);
  assert.equal(event.ko.semifinals, null); // still not generated
  assert.equal(projection.semifinals[0].top.known, true);
  assert.equal(projection.semifinals[0].top.playerId, qf1.p1.playerId);
  assert.equal(projection.semifinals[0].bottom.known, false);
  assert.equal(projection.semifinals[0].bottom.sourceLabel, 'WINNER QF2');
});

// ---------------------------------------------------------------------------
// Starting QF replaces preview data with the actual generated match
// ---------------------------------------------------------------------------

test('starting Quarterfinals replaces the QF preview slots with real generated matches', () => {
  let event = startTop16(readyForTop16());
  event.ko.top16.matches.forEach((m) => { event = recordKoResult(event, 'top16', { matchNumber: m.matchNumber, r1: 7, r2: 0 }); });

  const previewBefore = getBracketProjection(event);
  assert.equal(previewBefore.quarterfinals.every((s) => !s.real), true);

  event = startKoStage(event, 'quarterfinals');
  const projectionAfter = getBracketProjection(event);
  assert.equal(projectionAfter.quarterfinals.every((s) => s.real), true);
  assert.equal(projectionAfter.quarterfinals[0].match.matchNumber, 1);
  assert.equal(projectionAfter.quarterfinals[0].match.p1.seed, 'A1');
});

// ---------------------------------------------------------------------------
// No generic "TBD" values are required for bracket structure
// ---------------------------------------------------------------------------

test('no slot anywhere in the projection ever uses a generic "TBD" string — every unresolved slot carries a specific WINNER/Awaiting source label', () => {
  const collectLabels = (projection) => {
    const labels = [];
    ['top16', 'quarterfinals', 'semifinals', 'final'].forEach((stage) => {
      projection[stage].forEach((slot) => {
        if (!slot.real) {
          if (!slot.top.known) labels.push(slot.top.sourceLabel);
          if (!slot.bottom.known) labels.push(slot.bottom.sourceLabel);
        }
      });
    });
    return labels;
  };
  const freshEvent = createCanalettoEvent();
  const labels = collectLabels(getBracketProjection(freshEvent));
  assert.ok(labels.length > 0);
  labels.forEach((label) => {
    assert.notEqual(label, 'TBD');
    assert.ok(label.startsWith('WINNER') || label.startsWith('Awaiting'));
  });
});

// ---------------------------------------------------------------------------
// buildBracketProjection() directly (canalettoKo.js level) — pure, no
// mutation, winner propagation/stage-start rules unchanged
// ---------------------------------------------------------------------------

test('buildBracketProjection never mutates its `ko` input', () => {
  let event = startTop16(readyForTop16());
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 3 });
  const koBefore = JSON.parse(JSON.stringify(event.ko));
  buildBracketProjection(event.ko, getTop16Seeding(event));
  assert.deepEqual(event.ko, koBefore);
});

test('the projection\'s real-slot match data is byte-identical to the authoritative event.ko match data (no second source of truth)', () => {
  let event = startTop16(readyForTop16());
  event = recordKoResult(event, 'top16', { matchNumber: 1, r1: 7, r2: 3 });
  const projection = getBracketProjection(event);
  assert.deepEqual(projection.top16[0].match, event.ko.top16.matches[0]);
});
