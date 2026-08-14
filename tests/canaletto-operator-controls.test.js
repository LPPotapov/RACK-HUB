import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPendingPlayerToBlock,
  advanceBlockRound,
  applyBlockManualPairings,
  canResetBlockTournament,
  canResetTop16,
  canUnlockBlock,
  createCanalettoEvent,
  addPlayerToBlock,
  getBlockResultsRows,
  getBlockStandings,
  getBlockStatus,
  getTop16Status,
  lockBlock,
  markBlockPlayerMissing,
  recordBlockMatchResult,
  resetBlockCurrentRound,
  resetBlockTournament,
  resetTop16,
  startBlock,
  startTop16,
  undoBlockPlayerMissing,
  unlockBlock
} from '../src/application/canalettoEvent.js';

const rosterOf = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Player ${i + 1}`, elo: 1500 + (n - i) }));

const startedEvent = (n = 6) => {
  let event = createCanalettoEvent({ roundsPerBlock: 2, racksPerMatch: 8, qualificationThreshold: 4 });
  rosterOf(n).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  event = startBlock(event, 'A', { seedMethod: 'cross_elo' });
  return event;
};

// ---------------------------------------------------------------------------
// Missing this round
// ---------------------------------------------------------------------------

// NOTE: the raw post-startBlock() player shape is intentionally minimal
// (mp/perf/games/opps/removed/joinedRound only — no perfCount/rp/
// racksWon/racksLost yet, see tournamentCommands.js's startTournament()
// docs) — recalculateTournamentPlayers() (invoked internally by
// markBlockPlayerMissing()) normalizes EVERY player to the full
// steady-state shape as part of any replay, so a "before" snapshot taken
// pre-recalculation cannot be directly diffed against the "after" shape
// field-for-field. These tests assert the specific numeric values the
// director specified instead of a raw before/after diff.
test('marking a player missing gives the opponent a bye: +1 MP, RP, no games/GBR/PERF/rack change', () => {
  let event = startedEvent(6); // odd-safe roster, 6 players -> 3 matches, no round-1 bye
  const round1 = event.blockA.tournament.rounds[1];
  const match = round1[0];
  const missingId = match.p2.id;
  const opponentId = match.p1.id;

  event = markBlockPlayerMissing(event, 'A', { matchId: match.id, missingPlayerId: missingId });

  const opponentAfter = event.blockA.tournament.players.find((p) => p.id === opponentId);
  assert.equal(opponentAfter.mp, 1);
  assert.equal(opponentAfter.games, 0); // no games increment
  assert.equal(opponentAfter.elo, match.p1.elo); // no GBR change from pairing-time snapshot
  assert.equal(opponentAfter.perf, 0); // no PERF change
  assert.equal(opponentAfter.racksWon, 0);
  assert.equal(opponentAfter.racksLost, 0);
  assert.equal(opponentAfter.opps.length, 0); // no opponent-history contribution
  // RP: rp_per_round + rp_per_mp (default config values), when use_rp is true.
  const config = event.blockA.tournament.config;
  if (config.use_rp) {
    assert.equal(opponentAfter.rp, config.rp_per_round + config.rp_per_mp);
  }
});

test('the missing player receives absolutely nothing: no MP/RP/game/GBR/PERF change, no penalty', () => {
  let event = startedEvent(6);
  const round1 = event.blockA.tournament.rounds[1];
  const match = round1[0];
  const missingId = match.p2.id;

  event = markBlockPlayerMissing(event, 'A', { matchId: match.id, missingPlayerId: missingId });

  const missingAfter = event.blockA.tournament.players.find((p) => p.id === missingId);
  assert.equal(missingAfter.mp, 0);
  assert.equal(missingAfter.games, 0);
  assert.equal(missingAfter.elo, match.p2.elo); // unchanged from their own pairing-time GBR
  assert.equal(missingAfter.perf, 0);
  assert.equal(missingAfter.racksWon, 0);
  assert.equal(missingAfter.racksLost, 0);
  assert.equal(missingAfter.removed, false); // no penalty, no withdrawal
  const config = event.blockA.tournament.config;
  if (config.use_rp) assert.equal(missingAfter.rp, 0);
});

test('missing designation is round-local, not withdrawal: player is never `removed`, roster untouched', () => {
  let event = startedEvent(6);
  const rosterBefore = event.blockA.tournament.roster;
  const match = event.blockA.tournament.rounds[1][0];
  const missingId = match.p2.id;

  event = markBlockPlayerMissing(event, 'A', { matchId: match.id, missingPlayerId: missingId });

  const missingPlayer = event.blockA.tournament.players.find((p) => p.id === missingId);
  assert.equal(missingPlayer.removed, false);
  assert.deepEqual(event.blockA.tournament.roster, rosterBefore);
});

test('a missing player automatically returns to normal pairing eligibility next round', () => {
  let event = startedEvent(6);
  const match = event.blockA.tournament.rounds[1][0];
  const missingId = match.p2.id;
  event = markBlockPlayerMissing(event, 'A', { matchId: match.id, missingPlayerId: missingId });

  // Complete every other Round 1 match (the missing-conversion match is
  // already done: true as a bye).
  event.blockA.tournament.rounds[1].forEach((m) => {
    if (m.id === match.id) return;
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });

  event = advanceBlockRound(event, 'A');
  const round2Ids = event.blockA.tournament.rounds[2].flatMap((m) => [m.p1.id, m.p2.id]);
  assert.ok(round2Ids.includes(missingId), 'the previously-missing player must appear in Round 2 pairing');
});

test('undo missing restores the exact original unplayed matchup, not a new pairing', () => {
  let event = startedEvent(6);
  const originalMatch = event.blockA.tournament.rounds[1][0];
  const missingId = originalMatch.p2.id;

  event = markBlockPlayerMissing(event, 'A', { matchId: originalMatch.id, missingPlayerId: missingId });
  event = undoBlockPlayerMissing(event, 'A', { matchId: originalMatch.id });

  const restored = event.blockA.tournament.rounds[1].find((m) => m.id === originalMatch.id);
  assert.deepEqual(restored, originalMatch);
});

test('missing state persists/reloads faithfully through JSON', () => {
  let event = startedEvent(6);
  const match = event.blockA.tournament.rounds[1][0];
  event = markBlockPlayerMissing(event, 'A', { matchId: match.id, missingPlayerId: match.p2.id });
  const restored = JSON.parse(JSON.stringify(event));
  assert.deepEqual(restored, event);
});

// ---------------------------------------------------------------------------
// Reset current round
// ---------------------------------------------------------------------------

test('resetting the current round erases results/missing designations and regenerates from pre-round state', () => {
  let event = startedEvent(6);
  const round1Before = event.blockA.tournament.rounds[1];
  const [m1, m2, m3] = round1Before;
  event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m1.id, r1: 5, r2: 3 });
  event = markBlockPlayerMissing(event, 'A', { matchId: m2.id, missingPlayerId: m2.p2.id });
  // m3 left untouched (open)

  event = resetBlockCurrentRound(event, 'A');

  const round1After = event.blockA.tournament.rounds[1];
  // Every match must be freshly generated, none carrying old results/missing state.
  round1After.forEach((m) => {
    assert.equal(m.canalettoMissing, undefined);
    if (!m.bye) assert.equal(m.done, false);
  });
});

test('resetting the current round does not touch prior completed rounds', () => {
  let event = startedEvent(6);
  event.blockA.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event = advanceBlockRound(event, 'A');
  const round1Before = JSON.parse(JSON.stringify(event.blockA.tournament.rounds[1]));

  // Mess with round 2, then reset it.
  const r2match = event.blockA.tournament.rounds[2][0];
  event = recordBlockMatchResult(event, 'A', { roundNumber: 2, matchId: r2match.id, r1: 5, r2: 3 });
  event = resetBlockCurrentRound(event, 'A');

  assert.deepEqual(event.blockA.tournament.rounds[1], round1Before);
});

test('resetting the current round refuses when a later round already exists', () => {
  let event = startedEvent(6);
  event.blockA.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event = advanceBlockRound(event, 'A'); // rounds 1 and 2 now both exist, currentRound: 2
  // Defensive edge case: an ApplicationState whose currentRound points at an
  // earlier round than what `rounds` actually contains must be refused, not
  // silently allowed to orphan the later round.
  const rolledBack = {
    ...event,
    blockA: { ...event.blockA, tournament: { ...event.blockA.tournament, currentRound: 1 } }
  };
  assert.throws(() => resetBlockCurrentRound(rolledBack, 'A'), /a later round already exists/);
});

// Bug fix: resetting Round 1 must reproduce the chosen Round 1 seed
// (cross_elo — Canaletto's default), not the generic MP -> PERF pairing
// order later rounds use. Before the fix, a freshly-reset Round 1 (everyone
// tied at MP=0/PERF=0) sorted by pairing order degenerated to id order,
// silently breaking cross_elo's top-half-vs-bottom-half-by-GBR seeding.
test('resetting Round 1 reproduces the chosen cross_elo seed, not the generic Round 2+ pairing order', () => {
  let event = startedEvent(6); // startBlock(..., { seedMethod: 'cross_elo' })
  const originalPairs = event.blockA.tournament.rounds[1]
    .filter((m) => !m.bye)
    .map((m) => [m.p1.id, m.p2.id].sort().join('-'))
    .sort();

  event = resetBlockCurrentRound(event, 'A');

  const resetPairs = event.blockA.tournament.rounds[1]
    .filter((m) => !m.bye)
    .map((m) => [m.p1.id, m.p2.id].sort().join('-'))
    .sort();
  assert.deepEqual(resetPairs, originalPairs);
});

test('resetting a Round 2+ round still uses the generic MP -> PERF pairing order (unaffected by the Round 1 fix)', () => {
  let event = startedEvent(6);
  event.blockA.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event = advanceBlockRound(event, 'A');
  const originalRound2Pairs = event.blockA.tournament.rounds[2]
    .filter((m) => !m.bye)
    .map((m) => [m.p1.id, m.p2.id].sort().join('-'))
    .sort();

  event = resetBlockCurrentRound(event, 'A');

  const resetRound2Pairs = event.blockA.tournament.rounds[2]
    .filter((m) => !m.bye)
    .map((m) => [m.p1.id, m.p2.id].sort().join('-'))
    .sort();
  assert.deepEqual(resetRound2Pairs, originalRound2Pairs);
});

test('derived standings return to the pre-round-1 state after resetting round 1', () => {
  let event = startedEvent(6);
  event.blockA.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 8, r2: 0 });
  });
  event = resetBlockCurrentRound(event, 'A');
  event.blockA.tournament.players.forEach((p) => {
    assert.equal(p.mp, 0);
    assert.equal(p.games, 0);
  });
});

// ---------------------------------------------------------------------------
// Manual pairing adjustment
// ---------------------------------------------------------------------------

test('manual pairing can rearrange still-open matches in the current round', () => {
  let event = startedEvent(6);
  const [m1, m2, m3] = event.blockA.tournament.rounds[1];
  const allIds = [m1, m2, m3].flatMap((m) => [m.p1.id, m.p2.id]);

  // Swap: pair m1.p1 with m2.p1, and m2.p2 with m1.p2, leave m3 as-is.
  const pairings = [
    { matchId: m1.id, p1Id: m1.p1.id, p2Id: m2.p1.id },
    { matchId: m2.id, p1Id: m2.p2.id, p2Id: m1.p2.id },
    { matchId: m3.id, p1Id: m3.p1.id, p2Id: m3.p2.id }
  ];
  event = applyBlockManualPairings(event, 'A', { pairings });

  const round = event.blockA.tournament.rounds[1];
  const newIds = round.flatMap((m) => [m.p1.id, m.p2.id]);
  assert.deepEqual(newIds.sort(), allIds.sort()); // same player pool, no one lost
  const updatedM1 = round.find((m) => m.id === m1.id);
  assert.equal(updatedM1.p2.id, m2.p1.id);
});

test('manual pairing rejects a duplicate player assignment', () => {
  let event = startedEvent(6);
  const [m1, m2, m3] = event.blockA.tournament.rounds[1];
  const pairings = [
    { matchId: m1.id, p1Id: m1.p1.id, p2Id: m1.p2.id },
    { matchId: m2.id, p1Id: m1.p1.id, p2Id: m2.p2.id }, // m1.p1 reused
    { matchId: m3.id, p1Id: m3.p1.id, p2Id: m3.p2.id }
  ];
  assert.throws(() => applyBlockManualPairings(event, 'A', { pairings }), /assigned to more than one match/);
});

test('manual pairing rejects a self-pair', () => {
  let event = startedEvent(6);
  const [m1, m2, m3] = event.blockA.tournament.rounds[1];
  const pairings = [
    { matchId: m1.id, p1Id: m1.p1.id, p2Id: m1.p1.id },
    { matchId: m2.id, p1Id: m2.p1.id, p2Id: m2.p2.id },
    { matchId: m3.id, p1Id: m3.p1.id, p2Id: m3.p2.id }
  ];
  assert.throws(() => applyBlockManualPairings(event, 'A', { pairings }), /against themselves/);
});

test('manual pairing cannot silently rewrite a completed match', () => {
  let event = startedEvent(6);
  const [m1, m2, m3] = event.blockA.tournament.rounds[1];
  event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m1.id, r1: 8, r2: 0 });

  // Only m2/m3 remain open; a pairings array trying to include the completed m1 is rejected.
  const pairings = [
    { matchId: m1.id, p1Id: m1.p1.id, p2Id: m2.p1.id },
    { matchId: m2.id, p1Id: m1.p2.id, p2Id: m2.p2.id }
  ];
  assert.throws(() => applyBlockManualPairings(event, 'A', { pairings }), /not an open match/);
});

test('manual pairing does not touch prior rounds', () => {
  let event = startedEvent(6);
  event.blockA.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event = advanceBlockRound(event, 'A');
  const round1Before = JSON.parse(JSON.stringify(event.blockA.tournament.rounds[1]));

  const [m1, m2, m3] = event.blockA.tournament.rounds[2];
  const pairings = [
    { matchId: m1.id, p1Id: m1.p2.id, p2Id: m1.p1.id },
    { matchId: m2.id, p1Id: m2.p1.id, p2Id: m2.p2.id },
    { matchId: m3.id, p1Id: m3.p1.id, p2Id: m3.p2.id }
  ];
  event = applyBlockManualPairings(event, 'A', { pairings });
  assert.deepEqual(event.blockA.tournament.rounds[1], round1Before);
});

test('manual pairing permits an explicit repeat opponent (no automatic block)', () => {
  let event = startedEvent(6);
  event.blockA.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event = advanceBlockRound(event, 'A');
  const round1 = event.blockA.tournament.rounds[1];
  const round2 = event.blockA.tournament.rounds[2];
  const [m1, m2, m3] = round2;

  // Force m1's round-2 pair back to their round-1 opponents (a repeat), then
  // pair the remaining 4 open players among m2/m3 (any valid arrangement —
  // the 6-player pool must be covered exactly once).
  const openIds = round2.flatMap((m) => [m.p1.id, m.p2.id]);
  const forcedPair = [round1[0].p1.id, round1[0].p2.id];
  const remaining = openIds.filter((id) => !forcedPair.includes(id));
  const pairings = [
    { matchId: m1.id, p1Id: forcedPair[0], p2Id: forcedPair[1] },
    { matchId: m2.id, p1Id: remaining[0], p2Id: remaining[1] },
    { matchId: m3.id, p1Id: remaining[2], p2Id: remaining[3] }
  ];
  // Should not throw even though it recreates a Round 1 pairing.
  assert.doesNotThrow(() => applyBlockManualPairings(event, 'A', { pairings }));
});

// ---------------------------------------------------------------------------
// Mid-tournament add player
// ---------------------------------------------------------------------------

test('a player added during Round 1 joins Round 2, not Round 1, and Round 1 pairings are unchanged', () => {
  let event = startedEvent(6);
  const round1Before = JSON.parse(JSON.stringify(event.blockA.tournament.rounds[1]));

  event = addPendingPlayerToBlock(event, 'A', { id: 999, name: 'Late Joiner', elo: 1550 });
  assert.deepEqual(event.blockA.tournament.rounds[1], round1Before);
  assert.equal(event.blockA.tournament.pendingPlayers.length, 1);

  event.blockA.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event = advanceBlockRound(event, 'A');

  const round2Ids = event.blockA.tournament.rounds[2].flatMap((m) => [m.p1.id, m.p2.id]);
  assert.ok(round2Ids.includes(999));
  const joined = event.blockA.tournament.players.find((p) => p.id === 999);
  assert.equal(joined.joinedRound, 2);
  assert.equal(joined.elo, 1550);
  assert.equal(event.blockA.tournament.pendingPlayers.length, 0);
});

test('cannot add a mid-tournament player to a locked block', () => {
  let event = startedEvent(6);
  event.blockA.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event = advanceBlockRound(event, 'A');
  event.blockA.tournament.rounds[2].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 2, matchId: m.id, r1: 5, r2: 3 });
  });
  event = lockBlock(event, 'A');
  assert.throws(() => addPendingPlayerToBlock(event, 'A', { id: 1000, name: 'Too Late', elo: 1500 }), /locked/);
});

// ---------------------------------------------------------------------------
// Reset Block Tournament (Danger Zone)
// ---------------------------------------------------------------------------

const fullyLockedEvent = () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 4 });
  rosterOf(6).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  rosterOf(6).forEach((p) => { event = addPlayerToBlock(event, 'B', { ...p, id: p.id + 100 }); });
  event = startBlock(event, 'A');
  event = startBlock(event, 'B');
  event.blockA.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event.blockB.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'B', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event = lockBlock(event, 'A');
  event = lockBlock(event, 'B');
  return event;
};

test('resetBlockTournament resets only the selected block, preserving roster/settings/tables and leaving the other block untouched', () => {
  let event = fullyLockedEvent();
  const rosterBefore = event.blockA.tournament.roster;
  const settingsBefore = event.settings;
  const blockBBefore = event.blockB;

  event = resetBlockTournament(event, 'A');

  assert.equal(getBlockStatus(event, 'A'), 'NOT_STARTED');
  assert.deepEqual(event.blockA.tournament.roster, rosterBefore);
  assert.deepEqual(event.settings, settingsBefore);
  assert.equal(event.blockALock, null);
  assert.equal(event.blockB, blockBBefore); // untouched, same reference
});

test('resetBlockTournament invalidates Top16 readiness', () => {
  let event = fullyLockedEvent();
  assert.equal(getTop16Status(event), 'READY');
  event = resetBlockTournament(event, 'A');
  assert.equal(getTop16Status(event), 'WAITING_FOR_A');
});

// ---------------------------------------------------------------------------
// Unlock Block Results
// ---------------------------------------------------------------------------

test('unlockBlock preserves rounds/results, clears the lock, and re-enables corrections', () => {
  let event = fullyLockedEvent();
  const roundsBefore = event.blockA.tournament.rounds;

  event = unlockBlock(event, 'A');

  assert.equal(getBlockStatus(event, 'A'), 'RUNNING');
  assert.deepEqual(event.blockA.tournament.rounds, roundsBefore);
  assert.equal(event.blockALock, null);
  // Corrections are possible again.
  const m = event.blockA.tournament.rounds[1][0];
  assert.doesNotThrow(() => recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 8, r2: 0 }));
});

test('unlockBlock removes that block\'s frozen qualifiers and Top16 partial seeds, leaving the other block untouched', () => {
  let event = fullyLockedEvent();
  const blockBLockBefore = event.blockBLock;

  event = unlockBlock(event, 'A');

  assert.equal(event.blockALock, null);
  assert.equal(event.blockBLock, blockBLockBefore);
  assert.equal(getTop16Status(event), 'WAITING_FOR_A');
});

test('unlockBlock is refused once Top16 has started', () => {
  let event = fullyLockedEvent();
  const eligibility = canUnlockBlock(event, 'A');
  assert.equal(eligibility.ok, true);
  // Simulate KO having started by directly checking the guard function's logic
  // via an event with top16.started true.
  const startedTop16Event = { ...event, top16: { started: true, startedAt: new Date().toISOString() } };
  assert.equal(canUnlockBlock(startedTop16Event, 'A').ok, false);
  assert.throws(() => unlockBlock(startedTop16Event, 'A'), /already started/);
});

// ---------------------------------------------------------------------------
// Reset Top 16 (bug fix: starting Top16 previously had no way back — both
// unlockBlock() and resetBlockTournament() correctly refuse to touch a
// source block while top16.started is true, but nothing could ever clear
// that flag again, permanently locking the director out of both blocks'
// Danger Zone actions once Top 16 was started).
// ---------------------------------------------------------------------------

const fullyLockedEventWithTop16Started = () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 8 });
  rosterOf(8).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  rosterOf(8).forEach((p) => { event = addPlayerToBlock(event, 'B', { ...p, id: p.id + 100 }); });
  event = startBlock(event, 'A');
  event = startBlock(event, 'B');
  event.blockA.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event.blockB.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'B', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event = lockBlock(event, 'A');
  event = lockBlock(event, 'B');
  event = startTop16(event);
  return event;
};

test('canResetTop16 is false until Top16 has started', () => {
  const event = createCanalettoEvent();
  assert.equal(canResetTop16(event).ok, false);
});

test('resetTop16 clears the started flag and is refused before Top16 has started', () => {
  let event = fullyLockedEventWithTop16Started();
  assert.equal(getTop16Status(event), 'RUNNING');

  event = resetTop16(event);

  assert.equal(event.top16.started, false);
  assert.equal(event.top16.startedAt, null);
  assert.equal(getTop16Status(event), 'READY');
  assert.throws(() => resetTop16(event), /has not started/);
});

test('resetTop16 does not touch either block\'s lock/qualifiers', () => {
  let event = fullyLockedEventWithTop16Started();
  const blockALockBefore = event.blockALock;
  const blockBLockBefore = event.blockBLock;

  event = resetTop16(event);

  assert.equal(event.blockALock, blockALockBefore);
  assert.equal(event.blockBLock, blockBLockBefore);
});

test('resetTop16 un-blocks unlockBlock()/resetBlockTournament() again — the actual bug fix', () => {
  let event = fullyLockedEventWithTop16Started();
  assert.equal(canUnlockBlock(event, 'A').ok, false);
  assert.equal(canResetBlockTournament(event, 'A').ok, false);

  event = resetTop16(event);

  assert.equal(canUnlockBlock(event, 'A').ok, true);
  assert.equal(canResetBlockTournament(event, 'A').ok, true);
  assert.doesNotThrow(() => unlockBlock(event, 'A'));
});
