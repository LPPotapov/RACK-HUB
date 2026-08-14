import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPlayerToBlock,
  advanceBlockRound,
  canLockBlock,
  computeTop16Seeding,
  createCanalettoEvent,
  getBlockResultsRows,
  getBlockStandings,
  getBlockStatus,
  getRoundStandings,
  getTop16Seeding,
  getTop16Status,
  lockBlock,
  recordBlockMatchResult,
  setEventTables,
  startBlock,
  startTop16,
  updateCanalettoSettings,
  validateCanalettoEvent
} from '../src/application/canalettoEvent.js';
import { createConfig } from '../src/domain/tournamentModel.js';

// Builds an event with N players seeded into both blocks (id/name/elo),
// ready to start.
const rosterOf = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Player ${i + 1}`, elo: 1500 + (n - i) }));

const eventWithRosters = (n = 8) => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 4 });
  rosterOf(n).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  rosterOf(n).forEach((p) => { event = addPlayerToBlock(event, 'B', { ...p, id: p.id + 100 }); });
  return event;
};

const completeCurrentRound = (event, block, r1 = 4, r2 = 4) => {
  const key = `block${block}`;
  const tournament = event[key].tournament;
  const round = tournament.rounds[tournament.currentRound];
  let next = event;
  round.forEach((m) => {
    if (m.bye) return;
    next = recordBlockMatchResult(next, block, { roundNumber: tournament.currentRound, matchId: m.id, r1, r2 });
  });
  return next;
};

test('createCanalettoEvent produces two independent, valid, not-started blocks with default settings', () => {
  const event = createCanalettoEvent();
  assert.deepEqual(validateCanalettoEvent(event), { valid: true, errors: [] });
  assert.equal(event.settings.roundsPerBlock, 5);
  assert.equal(event.settings.racksPerMatch, 8);
  assert.equal(event.settings.qualificationThreshold, 8);
  assert.equal(event.settings.round1SeedMethod, 'cross_elo');
  assert.equal(event.blockA.tournament.started, false);
  assert.equal(event.blockB.tournament.started, false);
  assert.equal(event.blockA.tournament.config.max_games, 8);
  assert.equal(event.blockA.tournament.config.default_rounds, 5);
  assert.equal(getBlockStatus(event, 'A'), 'NOT_STARTED');
  assert.equal(getBlockStatus(event, 'B'), 'NOT_STARTED');
});

test('qualification threshold is configurable', () => {
  const event = updateCanalettoSettings(createCanalettoEvent(), { qualificationThreshold: 4 });
  assert.equal(event.settings.qualificationThreshold, 4);
});

test('starting Block A does not start or otherwise change Block B (same object reference)', () => {
  const before = eventWithRosters(4);
  const after = startBlock(before, 'A');
  assert.equal(after.blockA.tournament.started, true);
  assert.equal(after.blockB, before.blockB); // untouched, same reference
  assert.equal(after.blockB.tournament.started, false);
});

test('starting Block B does not start or otherwise change Block A (same object reference)', () => {
  const before = eventWithRosters(4);
  const after = startBlock(before, 'B');
  assert.equal(after.blockB.tournament.started, true);
  assert.equal(after.blockA, before.blockA);
  assert.equal(after.blockA.tournament.started, false);
});

test('recording a Block A result does not change Block B', () => {
  let event = eventWithRosters(4);
  event = startBlock(event, 'A');
  event = startBlock(event, 'B');
  const blockBBefore = event.blockB;
  const match = event.blockA.tournament.rounds[1].find((m) => !m.bye);
  event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: match.id, r1: 5, r2: 3 });
  assert.equal(event.blockB, blockBBefore);
});

test('Round 1 seeding defaults to cross_elo and can be overridden per-block start', () => {
  let event = eventWithRosters(4);
  event = startBlock(event, 'A'); // default -> cross_elo
  assert.equal(event.blockA.tournament.rounds[1].length, 2);
});

test('lockBlock is refused before the block has started', () => {
  const event = eventWithRosters(4);
  const eligibility = canLockBlock(event, 'A');
  assert.equal(eligibility.ok, false);
  assert.throws(() => lockBlock(event, 'A'), /has not started/);
});

test('lockBlock is refused while rounds remain incomplete', () => {
  let event = eventWithRosters(4);
  event = startBlock(event, 'A');
  assert.equal(canLockBlock(event, 'A').ok, false);
  assert.throws(() => lockBlock(event, 'A'), /not yet fully completed|has not reached/);
});

test('lockBlock freezes the Top-N ranked qualifiers by current official standings', () => {
  let event = eventWithRosters(8); // roundsPerBlock: 1, qualificationThreshold: 4
  event = startBlock(event, 'A');
  event = completeCurrentRound(event, 'A', 5, 3); // every winner is the "top" seed
  event = lockBlock(event, 'A');
  assert.ok(event.blockALock);
  assert.equal(event.blockALock.qualifiers.length, 4);
  assert.deepEqual(event.blockALock.qualifiers.map((q) => q.seed), ['A1', 'A2', 'A3', 'A4']);
  const standings = getBlockStandings(event, 'A');
  assert.deepEqual(event.blockALock.qualifiers.map((q) => q.playerId), standings.slice(0, 4).map((p) => p.id));
});

test('a locked block rejects further result changes', () => {
  let event = eventWithRosters(8);
  event = startBlock(event, 'A');
  event = completeCurrentRound(event, 'A');
  event = lockBlock(event, 'A');
  const match = event.blockA.tournament.rounds[1][0];
  assert.throws(() => recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: match.id, r1: 8, r2: 0 }), /locked/);
});

test('a locked block rejects round advancement', () => {
  let event = eventWithRosters(8);
  event = startBlock(event, 'A');
  event = completeCurrentRound(event, 'A');
  event = lockBlock(event, 'A');
  assert.throws(() => advanceBlockRound(event, 'A'), /locked/);
});

test('one locked block does not make Top16 ready', () => {
  let event = eventWithRosters(8);
  event = startBlock(event, 'A');
  event = completeCurrentRound(event, 'A');
  event = lockBlock(event, 'A');
  assert.equal(getTop16Status(event), 'WAITING_FOR_B');
  assert.throws(() => computeTop16Seeding(event), /both Block A and Block B/);
  assert.throws(() => startTop16(event), /Both Block A and Block B/);
});

test('both blocks locked makes Top16 READY and generates the exact 8 seed pairings', () => {
  let event = eventWithRosters(16); // qualificationThreshold overridden to 8 below
  event = updateCanalettoSettings(event, { qualificationThreshold: 8 });
  event = startBlock(event, 'A');
  event = startBlock(event, 'B');
  event = completeCurrentRound(event, 'A', 5, 3);
  event = completeCurrentRound(event, 'B', 5, 3);
  event = lockBlock(event, 'A');
  event = lockBlock(event, 'B');
  assert.equal(getTop16Status(event), 'READY');

  const pairings = computeTop16Seeding(event);
  assert.equal(pairings.length, 8);
  const seedPairs = pairings.map((p) => `${p.top.seed} vs ${p.bottom.seed}`);
  assert.deepEqual(seedPairs, [
    'A1 vs B8', 'B1 vs A8',
    'A2 vs B7', 'B2 vs A7',
    'A3 vs B6', 'B3 vs A6',
    'A4 vs B5', 'B4 vs A5'
  ]);
});

test('TOP 16 STARTEN only becomes available once both blocks are locked, and generates 8 real matches', () => {
  let event = eventWithRosters(16);
  event = updateCanalettoSettings(event, { qualificationThreshold: 8 });
  event = startBlock(event, 'A');
  event = startBlock(event, 'B');
  event = completeCurrentRound(event, 'A');
  event = completeCurrentRound(event, 'B');
  event = lockBlock(event, 'A');
  event = lockBlock(event, 'B');
  assert.equal(event.ko.top16, null);
  event = startTop16(event);
  assert.equal(event.ko.top16.matches.length, 8);
  assert.equal(getTop16Status(event), 'RUNNING');
});

test('persistence/reload: JSON round-trip preserves lock, qualifier, and Top16 seeding state exactly', () => {
  let event = eventWithRosters(16);
  event = updateCanalettoSettings(event, { qualificationThreshold: 8 });
  event = startBlock(event, 'A');
  event = startBlock(event, 'B');
  event = completeCurrentRound(event, 'A');
  event = completeCurrentRound(event, 'B');
  event = lockBlock(event, 'A');
  event = lockBlock(event, 'B');
  event = startTop16(event);

  const restored = JSON.parse(JSON.stringify(event));
  assert.deepEqual(restored, event);
  assert.deepEqual(validateCanalettoEvent(restored), { valid: true, errors: [] });
  assert.deepEqual(computeTop16Seeding(restored), computeTop16Seeding(event));
});

// ---------------------------------------------------------------------------
// DIRECTOR CORRECTION PASSES — Canaletto RESULTS ranking (MP -> RackDiff ->
// PERF -> id) vs Canaletto PAIRING order (MP -> PERF -> id, RackDiff-free,
// as of the 2nd pass — see below). These are AUTHORITATIVELY DIFFERENT and
// must stay that way.
// ---------------------------------------------------------------------------
//
// Deterministic scenario (verified empirically before writing this test):
// 5 players, Z takes the Round 1 bye (lowest elo). W1 crushes W2 8:0 (a
// heavily-favored win — small PERF deviation, huge +8 RackDiff). X upsets Y
// 5:3 (Y was heavily favored and lost narrowly — huge PERF deviation, only
// -2 RackDiff for Y / +2 for X). After Round 1: W1/X/Z have MP=1; Y and W2
// are tied at MP=0, with Y having the BETTER RackDiff (-2 vs -8) but the
// WORSE PERF (~1027 vs ~1210). Canaletto order must rank Y above W2.
const rackDiffVsPerfEvent = () => {
  let event = createCanalettoEvent({ roundsPerBlock: 2, racksPerMatch: 8, qualificationThreshold: 4 });
  const roster = [
    { id: 1, name: 'W1', elo: 2200 },
    { id: 2, name: 'Y', elo: 2100 },
    { id: 3, name: 'W2', elo: 1200 },
    { id: 4, name: 'X', elo: 1100 },
    { id: 5, name: 'Z', elo: 100 }
  ];
  roster.forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  event = startBlock(event, 'A', { seedMethod: 'cross_elo' });

  const round1 = event.blockA.tournament.rounds[1];
  const m1 = round1.find((m) => !m.bye && m.p1.name === 'W1');
  const m2 = round1.find((m) => !m.bye && m.p1.name === 'Y');
  event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m1.id, r1: 8, r2: 0 }); // W1 crushes W2
  event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m2.id, r1: 3, r2: 5 }); // Y upset by X
  return event;
};

test('Canaletto standings rank RackDiff above PERF when MP is tied (director-decided order)', () => {
  const event = rackDiffVsPerfEvent();
  const standings = getBlockStandings(event, 'A');
  const y = standings.find((p) => p.name === 'Y');
  const w2 = standings.find((p) => p.name === 'W2');
  assert.equal(y.mp, 0);
  assert.equal(w2.mp, 0);
  assert.ok(y.rank < w2.rank, 'Y (better RackDiff, worse PERF) must outrank W2 under MP -> RackDiff -> PERF');
});

// 2nd director correction pass: the RackDiff-first pairing override has been
// REVERTED. Canaletto Round 2+ pairing must use the generic
// MP -> PERF -> id order (compareFixedRackPairingOrder, same as legacy),
// completely ignoring RackDiff — even though RackDiff still matters for
// RESULTS/qualification (see the standings test above, same scenario).
test('Canaletto Round 2+ pairing input is MP -> PERF -> id — RackDiff does NOT participate in pairing order', () => {
  let event = rackDiffVsPerfEvent();
  event = advanceBlockRound(event, 'A');
  const round2 = event.blockA.tournament.rounds[2];
  const byeMatch = round2.find((m) => m.bye);
  // Y has the WORSE PERF (~1027 vs W2's ~1210) despite the BETTER RackDiff
  // (-2 vs -8). Under MP -> PERF -> id pairing order, Y must sort last and
  // receive the bye — proving RackDiff was NOT consulted for pairing (a
  // RackDiff-aware order would instead give W2 the bye, as the results
  // ranking test above already confirms W2 ranks below Y there).
  assert.equal(byeMatch.p1.name, 'Y');
});

test('Canaletto pairing order and results order diverge for the same tied-MP pair (by design)', () => {
  const event = rackDiffVsPerfEvent();
  const standings = getBlockStandings(event, 'A');
  const y = standings.find((p) => p.name === 'Y');
  const w2 = standings.find((p) => p.name === 'W2');
  // RESULTS: Y outranks W2 (RackDiff -2 beats -8).
  assert.ok(y.rank < w2.rank);
  // PAIRING (proven above): W2 outranks Y (PERF ~1210 beats ~1027) — the
  // opposite relative order. This divergence is intentional, not a bug.
});

test('Canaletto qualification/lock freezes qualifiers in the SAME corrected order as standings', () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 4 });
  rosterOf(6).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  event = startBlock(event, 'A');
  event = completeCurrentRound(event, 'A', 5, 3);
  const standingsOrder = getBlockStandings(event, 'A').slice(0, 4).map((p) => p.id);
  event = lockBlock(event, 'A');
  assert.deepEqual(event.blockALock.qualifiers.map((q) => q.playerId), standingsOrder);
});

test('legacy fallback default ranking (createConfig) remains "classic" — unaffected by the Canaletto ordering decision', () => {
  assert.equal(createConfig().ranking_system, 'classic');
});

// ---------------------------------------------------------------------------
// Delta GBR (current GBR vs the block's own starting GBR)
// ---------------------------------------------------------------------------

test('getBlockStandings reports startingGbr and deltaGbr relative to the block roster', () => {
  const event = rackDiffVsPerfEvent();
  const w1 = getBlockStandings(event, 'A').find((p) => p.name === 'W1');
  assert.equal(w1.startingGbr, 2200);
  assert.equal(w1.deltaGbr, w1.elo - 2200);
  assert.ok(w1.deltaGbr > 0, 'W1 crushed a much weaker opponent and should have gained GBR');
});

// ---------------------------------------------------------------------------
// Round standings snapshots (All Rounds view)
// ---------------------------------------------------------------------------

test('getRoundStandings reflects the state strictly after the given round, using Canaletto order', () => {
  const event = rackDiffVsPerfEvent();
  const afterRound1 = getRoundStandings(event, 'A', 1);
  assert.equal(afterRound1.length, 5);
  const y = afterRound1.find((p) => p.name === 'Y');
  const w2 = afterRound1.find((p) => p.name === 'W2');
  assert.ok(y.rank < w2.rank);
});

test('a correction to an earlier round is reflected in that round\'s reconstructed standings, without altering stored pairings', () => {
  let event = rackDiffVsPerfEvent();
  const round1 = event.blockA.tournament.rounds[1];
  const m2 = round1.find((m) => !m.bye && (m.p1.name === 'Y' || m.p2.name === 'Y'));
  const pairingBefore = JSON.parse(JSON.stringify(event.blockA.tournament.rounds[1]));

  // Correct: Y actually WINS 5:3 instead of losing 3:5.
  event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m2.id, r1: 5, r2: 3 });

  const afterCorrection = getRoundStandings(event, 'A', 1);
  const y = afterCorrection.find((p) => p.name === 'Y');
  assert.equal(y.mp, 1, 'the corrected Round 1 standings must show Y as a winner now');

  // Stored pairing (who played whom) is untouched by the correction.
  assert.deepEqual(
    event.blockA.tournament.rounds[1].map((m) => ({ id: m.id, p1: m.p1.name, p2: m.p2.name, bye: m.bye })),
    pairingBefore.map((m) => ({ id: m.id, p1: m.p1.name, p2: m.p2.name, bye: m.bye }))
  );
});

// ---------------------------------------------------------------------------
// Table configuration
// ---------------------------------------------------------------------------

test('setEventTables stores the ordered table list and is usable before either block starts', () => {
  let event = createCanalettoEvent();
  const tables = [
    { order: 1, label: '301 TV', billardPadId: 'KO40QM2MNDMD', scoreLink: 'https://example.com/1' },
    { order: 2, label: '302', billardPadId: '6CSGGODKAFBJ', scoreLink: 'https://example.com/2' }
  ];
  event = setEventTables(event, tables);
  assert.deepEqual(event.tables, tables);
});

test('starting a block without explicit tableNumbers uses the configured event table labels, in order', () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8 });
  event = setEventTables(event, [
    { order: 1, label: '301 TV', billardPadId: null, scoreLink: null },
    { order: 2, label: '302', billardPadId: null, scoreLink: null }
  ]);
  rosterOf(4).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  event = startBlock(event, 'A');
  const tables = event.blockA.tournament.rounds[1].filter((m) => !m.bye).map((m) => m.tbl);
  assert.deepEqual(tables, ['301 TV', '302']);
});

// ---------------------------------------------------------------------------
// Top16 — always-visible seed preview + partial population
// ---------------------------------------------------------------------------

test('Top16 seed preview always returns 8 slots, even before either block has started', () => {
  const event = createCanalettoEvent();
  const pairings = getTop16Seeding(event);
  assert.equal(pairings.length, 8);
  pairings.forEach((p) => {
    assert.equal(p.top.placeholder, true);
    assert.equal(p.bottom.placeholder, true);
  });
});

test('locking Block A alone populates only the A seed positions; B remains placeholders', () => {
  let event = eventWithRosters(8);
  event = updateCanalettoSettings(event, { qualificationThreshold: 8 });
  event = startBlock(event, 'A');
  event = completeCurrentRound(event, 'A');
  event = lockBlock(event, 'A');

  const pairings = getTop16Seeding(event);
  pairings.forEach((p) => {
    const aSide = p.top.seed.startsWith('A') ? p.top : p.bottom;
    const bSide = p.top.seed.startsWith('B') ? p.top : p.bottom;
    assert.equal(aSide.placeholder, undefined);
    assert.equal(bSide.placeholder, true);
  });
});

test('locking the second block fills every remaining placeholder and matches the strict seeding exactly', () => {
  let event = eventWithRosters(8);
  event = updateCanalettoSettings(event, { qualificationThreshold: 8 });
  event = startBlock(event, 'A');
  event = startBlock(event, 'B');
  event = completeCurrentRound(event, 'A');
  event = completeCurrentRound(event, 'B');
  event = lockBlock(event, 'A');
  event = lockBlock(event, 'B');

  const preview = getTop16Seeding(event);
  const strict = computeTop16Seeding(event);
  assert.deepEqual(preview, strict);
  preview.forEach((p) => {
    assert.equal(p.top.placeholder, undefined);
    assert.equal(p.bottom.placeholder, undefined);
  });
});

// ---------------------------------------------------------------------------
// Locked qualifiers — frozen-identity display flagging (2nd correction pass)
// ---------------------------------------------------------------------------

test('before lock, getBlockResultsRows carries no lockedQualifier flag (ordinary live qualification state)', () => {
  let event = eventWithRosters(8); // qualificationThreshold: 4
  event = startBlock(event, 'A');
  const rows = getBlockResultsRows(event, 'A');
  assert.equal(rows.length, 8);
  rows.forEach((p) => assert.equal(p.lockedQualifier, undefined));
});

test('after lock, exactly the frozen qualifiers are flagged lockedQualifier: true; the rest are false', () => {
  let event = eventWithRosters(8); // qualificationThreshold: 4
  event = startBlock(event, 'A');
  event = completeCurrentRound(event, 'A', 5, 3);
  const frozenIds = getBlockStandings(event, 'A').slice(0, 4).map((p) => p.id);
  event = lockBlock(event, 'A');

  const rows = getBlockResultsRows(event, 'A');
  const flaggedIds = rows.filter((p) => p.lockedQualifier).map((p) => p.playerId);
  assert.deepEqual(flaggedIds.sort(), frozenIds.sort());
  assert.equal(rows.filter((p) => p.lockedQualifier).length, 4);
  assert.equal(rows.filter((p) => !p.lockedQualifier).length, 4);
});

test('locked qualifier identity is frozen — a locked block rejects any command that could otherwise change the derived Top-N', () => {
  let event = eventWithRosters(8);
  event = startBlock(event, 'A');
  event = completeCurrentRound(event, 'A', 5, 3);
  event = lockBlock(event, 'A');
  const before = getBlockResultsRows(event, 'A');

  const match = event.blockA.tournament.rounds[1][0];
  assert.throws(() => recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: match.id, r1: 0, r2: 8 }));

  // Rejected — event/rows are unchanged (same reference-equal outcome as before).
  const after = getBlockResultsRows(event, 'A');
  assert.deepEqual(after, before);
});
