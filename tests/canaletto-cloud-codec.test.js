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
import { createCanalettoLiveState, getTvSelectableMatches, resolveTvMatch, selectTvMatch } from '../src/application/canalettoLive.js';
import { derivePublicState, validatePublicState } from '../src/application/canalettoPublicState.js';
import {
  decodeEventFromCloud,
  decodePublicStateFromCloud,
  encodeEventForCloud,
  encodePublicStateForCloud
} from '../src/firebase/canalettoCloudCodec.js';

// ---------------------------------------------------------------------------
// simulateRtdb() — a test double reproducing the TWO Realtime Database
// representational behaviors empirically confirmed against the real
// production database during the event-blocking cloud sync investigation
// (`firebase database:get`, read-only):
//   1. `null`/`undefined` values and empty arrays/objects are not stored at
//      all — the key is simply absent on read (confirmed: `tables` and
//      `blockA.tournament.pendingPlayers` both came back `null`).
//   2. A plain object whose keys are ALL non-negative-integer strings is
//      silently reinterpreted as a sparse JS array, null-padding any
//      missing index below the highest key (confirmed: `rounds` — with
//      only key "1" — came back as `[null, [...]]`, not `{"1": [...]}`).
// This is not a claim of exact RTDB internals for every possible shape —
// it is a direct model of the specific corruption observed in production,
// used to prove the codec fixes it.
// ---------------------------------------------------------------------------
const isPlainObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

const simulateRtdb = (value) => {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const mapped = value.map(simulateRtdb).filter((v) => v !== undefined);
    return mapped.length ? mapped : undefined;
  }
  if (isPlainObj(value)) {
    const entries = Object.entries(value)
      .map(([k, v]) => [k, simulateRtdb(v)])
      .filter(([, v]) => v !== undefined);
    if (entries.length === 0) return undefined;
    const allNumericKeys = entries.every(([k]) => /^\d+$/.test(k));
    if (allNumericKeys) {
      const maxIndex = Math.max(...entries.map(([k]) => Number(k)));
      const arr = new Array(maxIndex + 1).fill(null);
      entries.forEach(([k, v]) => { arr[Number(k)] = v; });
      return arr;
    }
    return Object.fromEntries(entries);
  }
  return value;
};

const rosterOf = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, name: `Player ${offset + i + 1}`, elo: 1500 + (n - i) }));
const tablesOf = (n) => Array.from({ length: n }, (_, i) => ({ order: i + 1, label: `Table ${i + 1}` }));

const richEvent = () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 8 });
  event = setEventTables(event, tablesOf(3));
  rosterOf(16).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  rosterOf(16, 100).forEach((p) => { event = addPlayerToBlock(event, 'B', p); });
  event = startBlock(event, 'A');
  event = startBlock(event, 'B');
  ['A', 'B'].forEach((block) => {
    event[`block${block}`].tournament.rounds[1].forEach((m) => {
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

const cloudRoundTrip = (event) => decodeEventFromCloud(simulateRtdb(encodeEventForCloud(event)));
const publicCloudRoundTrip = (publicState) => decodePublicStateFromCloud(simulateRtdb(encodePublicStateForCloud(publicState)));

// ---------------------------------------------------------------------------
// Root-cause regression: a full valid CanalettoEvent must survive the
// Firebase round trip and STILL validate — this reproduces and fixes the
// exact "tables must be an array; blockA.tournament.pendingPlayers must be
// an array; ...blockA.tournament.rounds must be a plain object keyed by
// round number" failure observed against production data.
// ---------------------------------------------------------------------------

test('a full valid CanalettoEvent can be written to privateState and read back validating successfully', () => {
  const event = richEvent();
  const roundTripped = cloudRoundTrip(event);
  const result = validateCanalettoEvent(roundTripped);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('WITHOUT the codec, the same round trip reproduces the exact reported corruption (proves the codec is necessary, not just nice-to-have)', () => {
  const event = richEvent();
  const naive = simulateRtdb(event); // no encode/decode at all
  const result = validateCanalettoEvent(naive);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('rounds must be a plain object')));
});

test('rounds keyed by round number survive the round trip with correct keys and content', () => {
  const event = richEvent();
  const roundTripped = cloudRoundTrip(event);
  assert.deepEqual(Object.keys(roundTripped.blockA.tournament.rounds), ['1']);
  const original = event.blockA.tournament.rounds[1];
  const decoded = roundTripped.blockA.tournament.rounds[1];
  assert.equal(decoded.length, original.length);
  // Structurally important fields survive exactly; a genuinely-empty
  // nested array field like a player snapshot's `opps: []` legitimately
  // does NOT survive a real RTDB round trip (RTDB drops empty arrays at
  // every depth, not just the specific fields this codec defaults) — that
  // is expected, not a regression, so this deliberately does not assert
  // full deep-equality of the whole match object.
  original.forEach((match, i) => {
    assert.equal(decoded[i].id, match.id);
    assert.equal(decoded[i].r1, match.r1);
    assert.equal(decoded[i].r2, match.r2);
    assert.equal(decoded[i].p1.name, match.p1.name);
    assert.equal(decoded[i].p2.name, match.p2.name);
    assert.equal(decoded[i].tbl, match.tbl);
  });
});

test('an empty tables/pendingPlayers array (dropped entirely by RTDB) decodes back to [] rather than staying absent', () => {
  const event = createCanalettoEvent(); // tables: [], both blocks' pendingPlayers: []
  assert.deepEqual(event.tables, []);
  const roundTripped = cloudRoundTrip(event);
  assert.deepEqual(roundTripped.tables, []);
  assert.deepEqual(roundTripped.blockA.tournament.pendingPlayers, []);
  assert.equal(validateCanalettoEvent(roundTripped).valid, true);
});

test('decodeEventFromCloud also repairs data ALREADY corrupted in the database today (pre-fix legacy writes), not just future writes', () => {
  // Hand-built to mirror exactly what `firebase database:get` returned in
  // production: rounds already reinterpreted as a sparse array, unrelated
  // to whether this specific payload ever passed through encodeEventForCloud.
  const legacyCorrupted = {
    schemaVersion: 1,
    settings: { title: 'T' },
    schedule: {},
    koGbrWeight: 0.5,
    blockA: {
      tournament: {
        schemaVersion: 1,
        started: true,
        currentRound: 1,
        totalRounds: 1,
        config: {},
        tournamentConfig: {},
        roster: [{ id: 1, name: 'A', elo: 1500 }],
        players: [{ id: 1, name: 'A', elo: 1500, mp: 0 }],
        rounds: [null, [{ id: 1, done: false, cancelled: false, bye: false, p1: { id: 1 }, p2: { id: 2 } }]]
      }
    },
    blockB: {
      tournament: {
        schemaVersion: 1,
        started: false,
        currentRound: 0,
        totalRounds: 1,
        config: {},
        tournamentConfig: {},
        roster: [],
        players: [],
        rounds: []
      }
    }
    // tables/blockALock/blockBLock/ko/blockATableConfirmations/
    // blockBTableConfirmations all absent, exactly like production.
  };
  const decoded = decodeEventFromCloud(legacyCorrupted);
  assert.deepEqual(Object.keys(decoded.blockA.tournament.rounds), ['1']);
  assert.deepEqual(decoded.tables, []);
  assert.deepEqual(decoded.blockB.tournament.rounds, {});
  const result = validateCanalettoEvent(decoded);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('koGbrWeight and other real values are unaffected by the round trip', () => {
  const event = richEvent();
  const roundTripped = cloudRoundTrip(event);
  assert.equal(getKoGbrWeight(roundTripped), 0.75);
});

// ---------------------------------------------------------------------------
// publicState: reduced projection must ALSO survive the round trip, and a
// full private event must never be substitutable for it or vice versa.
// ---------------------------------------------------------------------------

test('a reduced publicState survives the cloud round trip and remains valid per its OWN lightweight schema', () => {
  const event = richEvent();
  const publicState = derivePublicState(event, null);
  const roundTripped = publicCloudRoundTrip(publicState);
  const result = validatePublicState(roundTripped);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('a reduced publicState, even after surviving the round trip, still fails the FULL-event validator (it must never be written to privateState)', () => {
  const event = richEvent();
  const publicState = derivePublicState(event, null);
  const roundTripped = publicCloudRoundTrip(publicState);
  assert.equal(validateCanalettoEvent(roundTripped).valid, false);
});

test('table labels survive the full cloud round trip, both at the event level and on individual matches', () => {
  const event = richEvent();
  const roundTripped = cloudRoundTrip(event);
  assert.deepEqual(roundTripped.tables, event.tables);
  const koMatch = roundTripped.ko.top16.matches.find((m) => m.tbl);
  assert.equal(koMatch.tbl, 'Table 1');
});

test('a started block produces a correct Stream Staff match catalog after the full publicState cloud round trip', () => {
  const event = richEvent();
  const publicState = publicCloudRoundTrip(derivePublicState(event, null));
  const rows = getTvSelectableMatches(publicState);
  assert.ok(rows.some((r) => r.source === 'ko'));
  const koRow = rows.find((r) => r.source === 'ko');
  assert.ok(koRow.p1Name);
  assert.ok(koRow.p2Name);
  assert.equal(koRow.tbl, 'Table 1');
});

test('a TV-selected match resolves correctly from a round-tripped publicState', () => {
  const event = richEvent();
  const publicState = publicCloudRoundTrip(derivePublicState(event, null));
  const targetMatchNumber = event.ko.top16.matches[1].matchNumber;
  const liveState = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: targetMatchNumber });
  const resolved = resolveTvMatch(publicState, liveState);
  assert.equal(resolved.p1.name, event.ko.top16.matches[1].p1.name);
  assert.equal(resolved.p2.name, event.ko.top16.matches[1].p2.name);
});

test('per-match manual stream score stays independent of official score across the whole pipeline (live is never part of privateState/publicState)', () => {
  const event = richEvent();
  const koMatch = event.ko.top16.matches[0]; // has an OFFICIAL result: 7-2
  const publicState = publicCloudRoundTrip(derivePublicState(event, null));
  assert.equal('tvScores' in publicState, false);
  assert.equal('tvMatch' in publicState, false);
  // Official result is completely unaffected by any of this.
  const roundTrippedPrivate = cloudRoundTrip(event);
  const roundTrippedMatch = roundTrippedPrivate.ko.top16.matches.find((m) => m.matchNumber === koMatch.matchNumber);
  assert.equal(roundTrippedMatch.r1, 7);
  assert.equal(roundTrippedMatch.r2, 2);
});
