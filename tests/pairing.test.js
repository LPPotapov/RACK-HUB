import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePairings } from '../src/domain/pairing.js';
import { createConfig } from '../src/domain/tournamentModel.js';

// Round-1-from-start player shape: exactly what startTournament() builds
// (roster player spread + mp/perf/games/opps/removed/joinedRound — no
// perfCount/racksWon/racksLost/avgPerf yet, matching the actual current code).
const startPlayer = (id, name, elo) => ({ id, name, elo, mp: 0, perf: 0, games: 0, opps: [], removed: false, joinedRound: 1 });

const fixedRackConfig = () => createConfig();
const straightPoolConfig = () => createConfig({ format: 'straight_pool_14_1', straightPool: { enabled: true } });

// ---------------------------------------------------------------------------
// Round 1 direct-pairing seed methods
// ---------------------------------------------------------------------------

test('random/manual seeding: sequential pairing (0v1, 2v3, ...) in the given array order', () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500), startPlayer(3, 'C', 1550), startPlayer(4, 'D', 1450)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'random', config: fixedRackConfig() });

  assert.equal(matches.length, 2);
  assert.equal(matches[0].p1.id, 1);
  assert.equal(matches[0].p2.id, 2);
  assert.equal(matches[1].p1.id, 3);
  assert.equal(matches[1].p2.id, 4);
});

test('manual seeding uses the same sequential pairing as random', () => {
  const players = [startPlayer(4, 'D', 1450), startPlayer(1, 'A', 1600), startPlayer(3, 'C', 1550), startPlayer(2, 'B', 1500)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'manual', config: fixedRackConfig() });

  assert.equal(matches[0].p1.id, 4);
  assert.equal(matches[0].p2.id, 1);
  assert.equal(matches[1].p1.id, 3);
  assert.equal(matches[1].p2.id, 2);
});

test('cross_elo seeding: top half vs bottom half of the given (pre-sorted) order', () => {
  const players = [startPlayer(1, 'A', 1700), startPlayer(2, 'B', 1600), startPlayer(3, 'C', 1550), startPlayer(4, 'D', 1400)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'cross_elo', config: fixedRackConfig() });

  assert.equal(matches.length, 2);
  assert.equal(matches[0].p1.id, 1); // top half[0]
  assert.equal(matches[0].p2.id, 3); // bottom half[0]
  assert.equal(matches[1].p1.id, 2); // top half[1]
  assert.equal(matches[1].p2.id, 4); // bottom half[1]
});

test('an unrecognized/elo seedMethod at round 1 falls through to Swiss cost-based pairing, not sequential', () => {
  // With no opps/mp history, cost is purely the elo/avgPerf gap. Closest pairs first.
  const players = [startPlayer(1, 'A', 1000), startPlayer(2, 'B', 1010), startPlayer(3, 'C', 2000), startPlayer(4, 'D', 2010)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'elo', config: fixedRackConfig() });

  assert.equal(matches.length, 2);
  const pairedIds = matches.map((m) => [m.p1.id, m.p2.id].sort()).sort();
  assert.deepEqual(pairedIds, [[1, 2], [3, 4]]); // closest-elo pairs, not sequential input order
});

test('a null seedMethod at round 1 also falls through to Swiss cost-based pairing', () => {
  const players = [startPlayer(1, 'A', 1000), startPlayer(2, 'B', 1010), startPlayer(3, 'C', 2000), startPlayer(4, 'D', 2010)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: null, config: fixedRackConfig() });
  const pairedIds = matches.map((m) => [m.p1.id, m.p2.id].sort()).sort();
  assert.deepEqual(pairedIds, [[1, 2], [3, 4]]);
});

// ---------------------------------------------------------------------------
// Byes
// ---------------------------------------------------------------------------

test('an odd player count assigns a bye to the last player in the given array (no bye/new-player history yet)', () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500), startPlayer(3, 'C', 1550)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'random', config: fixedRackConfig() });

  const byeMatch = matches.find((m) => m.bye);
  assert.ok(byeMatch);
  assert.equal(byeMatch.p1.id, 3); // last in the array
  assert.deepEqual(byeMatch.p2, { id: 'bye', name: 'FREILOS', elo: 1300 });
  assert.equal(byeMatch.r1, 0);
  assert.equal(byeMatch.r2, 0);
  assert.equal(byeMatch.done, true);
  assert.equal(byeMatch.cancelled, false);
});

test('returns null when no eligible bye exists for an odd player count (whitepaper §9.2)', () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500), startPlayer(3, 'C', 1550)];
  // Every player already had a bye in round 1; requesting round 2 with all three still active and odd.
  const allRounds = {
    1: [
      { id: 'x', p1: { id: 1 }, p2: { id: 'bye' }, bye: true },
      { id: 'y', p1: { id: 2 }, p2: { id: 'bye' }, bye: true }
    ]
  };
  // Only 1 and 2 have documented byes above; also mark 3 as having had one so all three are ineligible.
  allRounds[1].push({ id: 'z', p1: { id: 3 }, p2: { id: 'bye' }, bye: true });

  const matches = generatePairings(players, { roundNum: 2, seedMethod: 'random', allRounds, config: fixedRackConfig() });
  assert.equal(matches, null);
});

// ---------------------------------------------------------------------------
// Table assignment
// ---------------------------------------------------------------------------

test('tbl defaults to a 1-based sequential index (startTableIndex + idx + 1) when tableNumbers is empty', () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500), startPlayer(3, 'C', 1550), startPlayer(4, 'D', 1450)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'random', config: fixedRackConfig() });
  assert.equal(matches[0].tbl, 1);
  assert.equal(matches[1].tbl, 2);
});

test('tbl uses tableNumbers[startTableIndex + idx] when present and truthy', () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500), startPlayer(3, 'C', 1550), startPlayer(4, 'D', 1450)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'random', tableNumbers: [7, 9], config: fixedRackConfig() });
  assert.equal(matches[0].tbl, 7);
  assert.equal(matches[1].tbl, 9);
});

test('startTableIndex offsets which tableNumbers entries are consumed', () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'random', startTableIndex: 2, tableNumbers: [1, 2, 3, 4], config: fixedRackConfig() });
  assert.equal(matches[0].tbl, 3); // tableNumbers[2]
});

// Legacy expression is `tableNumbers[startTableIndex + idx] || (startTableIndex + idx + 1)`
// — `||` treats ANY falsy stored value as "use the fallback", not just a
// missing/undefined entry. Codex follow-up: pin the two falsy-but-present
// cases explicitly (0 and '') so this isn't only implied by the "empty
// tableNumbers" test above.

test('tableNumbers entry 0 falls back to the sequential table number (0 is falsy)', () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500), startPlayer(3, 'C', 1550), startPlayer(4, 'D', 1450)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'random', tableNumbers: [0, 9], config: fixedRackConfig() });
  assert.equal(matches[0].tbl, 1); // fallback: startTableIndex(0) + idx(0) + 1
  assert.equal(matches[1].tbl, 9); // real value used normally
});

test("tableNumbers entry '' falls back to the sequential table number ('' is falsy)", () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500), startPlayer(3, 'C', 1550), startPlayer(4, 'D', 1450)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'random', tableNumbers: ['', 'Court B'], config: fixedRackConfig() });
  assert.equal(matches[0].tbl, 1); // fallback: startTableIndex(0) + idx(0) + 1
  assert.equal(matches[1].tbl, 'Court B');
});

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

test('fixed_rack config produces fixed_rack matches with no 14.1 fields', () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'random', config: fixedRackConfig() });
  assert.equal(matches[0].format, 'fixed_rack');
  assert.equal('target' in matches[0], false);
  assert.equal('p1Points' in matches[0], false);
});

test('straight_pool_14_1 config stamps target/points/innings/high-run fields', () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'random', config: straightPoolConfig() });
  assert.equal(matches[0].format, 'straight_pool_14_1');
  assert.equal(typeof matches[0].target, 'number');
  assert.equal(matches[0].p1Points, 0);
  assert.equal(matches[0].p2Points, 0);
  assert.equal(matches[0].innings, 0);
  assert.equal(matches[0].p1HighRun, 0);
  assert.equal(matches[0].p2HighRun, 0);
});

test('a bye match in 14.1 mode has target: 0 (bye contributes no innings/points)', () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500), startPlayer(3, 'C', 1550)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'random', config: straightPoolConfig() });
  const byeMatch = matches.find((m) => m.bye);
  assert.equal(byeMatch.target, 0);
});

// ---------------------------------------------------------------------------
// Match id / shape
// ---------------------------------------------------------------------------

test('every match gets a numeric id and the expected base fields', () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500), startPlayer(3, 'C', 1550), startPlayer(4, 'D', 1450)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'random', config: fixedRackConfig() });
  matches.forEach((m) => {
    assert.equal(typeof m.id, 'number');
    assert.equal(typeof m.done, 'boolean');
    assert.equal(typeof m.cancelled, 'boolean');
    assert.equal(typeof m.bye, 'boolean');
  });
  assert.notEqual(matches[0].id, matches[1].id);
});

test('non-bye matches have done: false, cancelled: false', () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500)];
  const matches = generatePairings(players, { roundNum: 1, seedMethod: 'random', config: fixedRackConfig() });
  assert.equal(matches[0].done, false);
  assert.equal(matches[0].cancelled, false);
  assert.equal(matches[0].bye, false);
});

test('does not mutate the input players array or its elements', () => {
  const players = [startPlayer(1, 'A', 1600), startPlayer(2, 'B', 1500)];
  const snapshot = JSON.parse(JSON.stringify(players));
  generatePairings(players, { roundNum: 1, seedMethod: 'random', config: fixedRackConfig() });
  assert.deepEqual(players, snapshot);
});
