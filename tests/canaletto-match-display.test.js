import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPlayerToBlock,
  advanceBlockRound,
  createCanalettoEvent,
  recordBlockMatchResult,
  startBlock
} from '../src/application/canalettoEvent.js';
import { expectedScore } from '../src/domain/fixedRackBbs.js';
import { frozenMatchDisplay } from '../src/canaletto/matchDisplay.js';

test('frozenMatchDisplay reads the pairing-time snapshot directly off the match (p1.elo/p2.elo)', () => {
  const config = { d: 330 };
  const match = { p1: { name: 'A', elo: 1820 }, p2: { name: 'B', elo: 1710 } };
  const result = frozenMatchDisplay(match, config);
  assert.equal(result.p1Gbr, 1820);
  assert.equal(result.p2Gbr, 1710);
});

test('frozenMatchDisplay win% is the exact existing expectedScore() formula, unmodified', () => {
  const config = { d: 330 };
  const match = { p1: { name: 'A', elo: 1820 }, p2: { name: 'B', elo: 1710 } };
  const result = frozenMatchDisplay(match, config);
  assert.equal(result.p1WinPct, expectedScore(1820, 1710, 330) * 100);
  assert.equal(result.p2WinPct, expectedScore(1710, 1820, 330) * 100);
  // The two win percentages are complementary (sum to 100), matching the
  // legacy round-view's own two-call pattern.
  assert.ok(Math.abs(result.p1WinPct + result.p2WinPct - 100) < 1e-9);
});

// End-to-end proof of the actual bug fix, driven through the real Canaletto
// flow: completing a match changes tournament.players' CURRENT GBR, but the
// match's OWN stored p1/p2 snapshot — and therefore frozenMatchDisplay()'s
// output for that exact match object — must stay byte-identical.
test('completing a match changes current tournament GBR but leaves that match\'s frozen display values unchanged', () => {
  const config = { d: 330 };
  let event = createCanalettoEvent({ roundsPerBlock: 2, racksPerMatch: 8 });
  const roster = [
    { id: 1, name: 'Alpha', elo: 1900 },
    { id: 2, name: 'Bravo', elo: 1500 },
    { id: 3, name: 'Charlie', elo: 1700 },
    { id: 4, name: 'Delta', elo: 1600 }
  ];
  roster.forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  event = startBlock(event, 'A', { seedMethod: 'cross_elo' });

  const match = event.blockA.tournament.rounds[1][0];
  const before = frozenMatchDisplay(match, config);

  // Complete THIS match with a lopsided result — its own current elo will
  // move a lot.
  event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: match.id, r1: 8, r2: 0 });

  const currentPlayer = event.blockA.tournament.players.find((p) => p.id === match.p1.id);
  assert.notEqual(currentPlayer.elo, match.p1.elo, 'the player\'s current GBR must have moved after the result');

  // The STORED match object (as it now sits in tournament.rounds) is the
  // authoritative source for the frozen display — re-read it and confirm
  // p1/p2 are untouched.
  const storedMatch = event.blockA.tournament.rounds[1].find((m) => m.id === match.id);
  const after = frozenMatchDisplay(storedMatch, config);
  assert.deepEqual(after, before);
});

// Same guarantee for a LATER round's already-generated match: correcting a
// Round 1 result AFTER Round 2 already exists (which recalculates every
// player's current GBR) must not change the frozen display of the
// already-generated Round 2 match — this is the "previous round tabs /
// All Rounds historical matchup display" requirement.
test('a correction to an earlier round does not change an already-generated later round\'s frozen match display', () => {
  const config = { d: 330 };
  let event = createCanalettoEvent({ roundsPerBlock: 2, racksPerMatch: 8 });
  const roster = [
    { id: 1, name: 'Alpha', elo: 1900 },
    { id: 2, name: 'Bravo', elo: 1500 },
    { id: 3, name: 'Charlie', elo: 1700 },
    { id: 4, name: 'Delta', elo: 1600 }
  ];
  roster.forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  event = startBlock(event, 'A', { seedMethod: 'cross_elo' });

  event.blockA.tournament.rounds[1].forEach((m) => {
    event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
  });
  event = advanceBlockRound(event, 'A');

  const round2Match = event.blockA.tournament.rounds[2][0];
  const before = frozenMatchDisplay(round2Match, config);

  // Correct an EARLIER (Round 1) result — this recalculates current GBR for
  // everyone through recordMatchResult()'s full-history replay.
  const round1Match = event.blockA.tournament.rounds[1][0];
  event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId: round1Match.id, r1: 1, r2: 7 });

  const storedRound2Match = event.blockA.tournament.rounds[2].find((m) => m.id === round2Match.id);
  const after = frozenMatchDisplay(storedRound2Match, config);
  assert.deepEqual(after, before);
});
