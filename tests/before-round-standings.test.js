import assert from 'node:assert/strict';
import test from 'node:test';
import { reconstructStandingsBeforeRound } from '../src/domain/beforeRoundStandings.js';

const config = { d: 330, k_m: 30, k_r: 20 };
const closeTo = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

// ---------------------------------------------------------------------------
// A. Fixed-rack normal history: multiple rounds, deterministic processing
//    order, exact reconstructed snapshot before a later round.
//    Same 4-player fixture/values as the M2D-era synthetic replay fixture,
//    reconstructed "before round 3" (i.e. rounds 1-2 fully replayed).
// ---------------------------------------------------------------------------

const fourPlayers = [
  { id: 1, name: 'Alpha', elo: 1700 },
  { id: 2, name: 'Bravo', elo: 1600 },
  { id: 3, name: 'Charlie', elo: 1500 },
  { id: 4, name: 'Delta', elo: 1400 }
];
const fourPlayerRounds = {
  1: [
    { id: 'r1m1', p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1600 }, r1: 5, r2: 1, done: true, cancelled: false, bye: false },
    { id: 'r1m2', p1: { id: 3, elo: 1500 }, p2: { id: 4, elo: 1400 }, r1: 3, r2: 3, done: true, cancelled: false, bye: false },
    { id: 'cancelled', p1: { id: 1, elo: 1700 }, p2: { id: 3, elo: 1500 }, r1: 6, r2: 0, done: true, cancelled: true, bye: false },
    { id: 'incomplete', p1: { id: 2, elo: 1600 }, p2: { id: 4, elo: 1400 }, r1: 4, r2: 2, done: false, cancelled: false, bye: false }
  ],
  2: [
    { id: 'r2m1', p1: { id: 2, elo: 1586.7178037424442 }, p2: { id: 3, elo: 1491.6155295908893 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false },
    { id: 'r2m2', p1: { id: 1, elo: 1713.2821962575558 }, p2: { id: 4, elo: 1408.3844704091107 }, r1: 2, r2: 4, done: true, cancelled: false, bye: false }
  ]
};

test('A: fixed-rack normal history reconstructs an exact snapshot before round 3 (rounds 1-2 replayed in order)', () => {
  const standings = reconstructStandingsBeforeRound({
    players: fourPlayers,
    startingRoster: fourPlayers,
    rounds: fourPlayerRounds,
    roundLimit: 3,
    config
  });
  closeTo(standings[1].elo, 1675.2718085420506);
  closeTo(standings[2].elo, 1597.0479416625346);
  closeTo(standings[3].elo, 1481.2853916707988);
  closeTo(standings[4].elo, 1446.394858124616);
  assert.deepEqual([standings[1].mp, standings[2].mp, standings[3].mp, standings[4].mp], [1, 1, 0.5, 1.5]);
  assert.deepEqual([standings[1].games, standings[2].games, standings[3].games, standings[4].games], [2, 2, 2, 2]);
  assert.deepEqual([standings[1].racksWon, standings[2].racksWon, standings[3].racksWon, standings[4].racksWon], [7, 5, 5, 7]);
  assert.deepEqual([standings[1].racksLost, standings[2].racksLost, standings[3].racksLost, standings[4].racksLost], [5, 7, 7, 5]);
  assert.deepEqual(standings[1].opps, [2, 4]);
  assert.deepEqual(standings[2].opps, [1, 3]);
});

test('A: reconstructing before round 2 only replays round 1 (deterministic partial snapshot)', () => {
  const standings = reconstructStandingsBeforeRound({
    players: fourPlayers,
    startingRoster: fourPlayers,
    rounds: fourPlayerRounds,
    roundLimit: 2,
    config
  });
  closeTo(standings[1].elo, 1713.2821962575558);
  closeTo(standings[2].elo, 1586.7178037424442);
  assert.deepEqual([standings[1].games, standings[2].games, standings[3].games, standings[4].games], [1, 1, 1, 1]);
  assert.deepEqual(standings[1].opps, [2]);
});

// ---------------------------------------------------------------------------
// B. Removed/absent historical player — fixed-rack.
// ---------------------------------------------------------------------------

test('B: a removed historical fixed-rack opponent is excluded from standings, but the survivor is still scored using the match\'s stored GBR snapshot', () => {
  const players = [
    { id: 1, name: 'Withdrawn', elo: 1700, removed: true },
    { id: 2, name: 'Survivor', elo: 1600 }
  ];
  const rounds = {
    1: [{ id: 'm1', p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1600 }, r1: 5, r2: 1, done: true, cancelled: false, bye: false }]
  };
  const standings = reconstructStandingsBeforeRound({
    players, startingRoster: players, rounds, roundLimit: 2, config
  });

  // The removed player is not reintroduced into the reconstructed set.
  assert.equal(standings[1], undefined);
  assert.equal(Object.keys(standings).length, 1);

  // The survivor's result is computed as if against the removed player's
  // match-stored pre-match GBR (1700), not any other value.
  assert.equal(standings[2].mp, 0);
  assert.equal(standings[2].games, 1);
  closeTo(standings[2].elo, 1586.7178037424442);
  assert.equal(standings[2].perf, 1469);
  assert.equal(standings[2].racksWon, 1);
  assert.equal(standings[2].racksLost, 5);

  // Opponent history: since the removed player has no standings entry, the
  // survivor's opps list does NOT gain the removed player's id (matches the
  // existing `if (p1Data && ...)` guard in the pre-extraction component code).
  assert.deepEqual(standings[2].opps, []);
});

// ---------------------------------------------------------------------------
// C. Removed/absent historical player — 14.1.
// ---------------------------------------------------------------------------

test('C: a removed historical 14.1 opponent is excluded from standings, but the survivor is still scored using the match\'s stored GBR snapshot', () => {
  const players = [
    { id: 1, name: 'Withdrawn', elo: 1700, removed: true },
    { id: 2, name: 'Survivor', elo: 1500 }
  ];
  const rounds = {
    1: [{
      id: 'm1', format: 'straight_pool_14_1', bye: false, done: true, cancelled: false,
      p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1500 },
      p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4, target: 30
    }]
  };
  const standings = reconstructStandingsBeforeRound({
    players, startingRoster: players, rounds, roundLimit: 2, config
  });

  assert.equal(standings[1], undefined);
  assert.equal(Object.keys(standings).length, 1);

  assert.equal(standings[2].mp, 0);
  assert.equal(standings[2].games, 1);
  closeTo(standings[2].elo, 1495.7170278452193);
  assert.equal(standings[2].perf, 1575);
  closeTo(standings[2].npd, -0.4666666666666667);
  closeTo(standings[2].hgd, 16 / 9);
  assert.equal(standings[2].hs, 4);
  assert.equal(standings[2].pointsFor, 16);
  assert.equal(standings[2].pointsAgainst, 30);

  // Same opponent-history guard as the fixed-rack case.
  assert.deepEqual(standings[2].opps, []);
});

// ---------------------------------------------------------------------------
// D. joinedRound
// ---------------------------------------------------------------------------

test('D: a player is excluded before their joinedRound and included at/after it', () => {
  const players = [
    { id: 1, name: 'Original A', elo: 1600, joinedRound: 1 },
    { id: 2, name: 'Original B', elo: 1600, joinedRound: 1 },
    { id: 3, name: 'Joins later', elo: 1600, joinedRound: 3 }
  ];
  const rounds = {
    1: [{ id: 'm1', p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1600 }, r1: 5, r2: 1, done: true, cancelled: false, bye: false }]
  };
  const startingRoster = players;

  // Before round 2 (roundLimit=2 <= joinedRound 3): the late joiner is absent.
  const beforeRound2 = reconstructStandingsBeforeRound({ players, startingRoster, rounds, roundLimit: 2, config });
  assert.equal(beforeRound2[3], undefined);
  assert.equal(Object.keys(beforeRound2).length, 2);

  // At/after their joinedRound (roundLimit=3): the late joiner is included,
  // initialized with zero stats since they have no match history yet.
  const beforeRound3 = reconstructStandingsBeforeRound({ players, startingRoster, rounds, roundLimit: 3, config });
  assert.notEqual(beforeRound3[3], undefined);
  assert.equal(beforeRound3[3].mp, 0);
  assert.equal(beforeRound3[3].games, 0);
  assert.equal(beforeRound3[3].elo, 1600);
  assert.equal(Object.keys(beforeRound3).length, 3);
});

// ---------------------------------------------------------------------------
// E. cancelled / incomplete
// ---------------------------------------------------------------------------

test('E: cancelled and incomplete (not done) matches are ignored exactly like the normal-history fixture', () => {
  // Fixture A already embeds a cancelled (1v3) and an incomplete (2v4) Round 1
  // match; confirm neither affected the reconstructed Round-1 snapshot.
  const standings = reconstructStandingsBeforeRound({
    players: fourPlayers, startingRoster: fourPlayers, rounds: fourPlayerRounds, roundLimit: 2, config
  });
  // Player 1's only Round-1 opponent is 2 (not 3, from the cancelled match).
  assert.deepEqual(standings[1].opps, [2]);
  // Player 2's only Round-1 opponent is 1 (not 4, from the incomplete match).
  assert.deepEqual(standings[2].opps, [1]);
  assert.equal(standings[1].games, 1);
  assert.equal(standings[2].games, 1);
});

// ---------------------------------------------------------------------------
// F. bye
// ---------------------------------------------------------------------------

test('F: a bye contributes exactly +1 MP and +1 game, no rack/GBR/PERF effect, under either legacy bye encoding', () => {
  const players = [{ id: 1, name: 'Solo', elo: 1500 }];
  const startingRoster = players;

  // Encoding 1: createPairings()'s bye (r1/r2 absent/zero).
  const zeroScoreBye = reconstructStandingsBeforeRound({
    players, startingRoster,
    rounds: { 1: [{ id: 'bye1', p1: { id: 1, elo: 1500 }, p2: { id: 'bye' }, r1: 0, r2: 0, done: true, cancelled: false, bye: true }] },
    roundLimit: 2, config
  });
  assert.deepEqual(
    { mp: zeroScoreBye[1].mp, games: zeroScoreBye[1].games, elo: zeroScoreBye[1].elo, perf: zeroScoreBye[1].perf, racksWon: zeroScoreBye[1].racksWon, racksLost: zeroScoreBye[1].racksLost },
    { mp: 1, games: 1, elo: 1500, perf: 0, racksWon: 0, racksLost: 0 }
  );

  // Encoding 2: Manual Pairing Editor's bye (r1 = max_games, r2 = 0). The
  // before-round function only branches on `m.bye`, so both encodings must
  // produce an identical result — no normalization needed or attempted here.
  const sixZeroBye = reconstructStandingsBeforeRound({
    players, startingRoster,
    rounds: { 1: [{ id: 'bye2', p1: { id: 1, elo: 1500 }, p2: { id: 'bye' }, r1: 6, r2: 0, done: true, cancelled: false, bye: true }] },
    roundLimit: 2, config
  });
  assert.deepEqual(zeroScoreBye[1], sixZeroBye[1]);
});

// ---------------------------------------------------------------------------
// G. Format isolation
// ---------------------------------------------------------------------------

test('G: a fixed-rack match and a 14.1 match in the same round each use only their own domain helper, with no cross-contamination', () => {
  const players = [
    { id: 1, name: 'Rack A', elo: 1600 },
    { id: 2, name: 'Rack B', elo: 1600 },
    { id: 3, name: '14.1 A', elo: 1700 },
    { id: 4, name: '14.1 B', elo: 1500 }
  ];
  const rounds = {
    1: [
      { id: 'rack', p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1600 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false },
      {
        id: 'sp141', format: 'straight_pool_14_1', bye: false, done: true, cancelled: false,
        p1: { id: 3, elo: 1700 }, p2: { id: 4, elo: 1500 },
        p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4, target: 30
      }
    ]
  };
  const standings = reconstructStandingsBeforeRound({
    players, startingRoster: players, rounds, roundLimit: 2, config
  });

  // The fixed-rack players accumulate racks; the 14.1 players never touch racksWon/racksLost.
  assert.equal(standings[1].racksWon, 4);
  assert.equal(standings[2].racksWon, 2);
  assert.equal(standings[3].racksWon, 0);
  assert.equal(standings[4].racksWon, 0);

  // The 14.1 players accumulate points/innings/npd; the fixed-rack players never do.
  assert.equal(standings[3].pointsFor, 30);
  assert.equal(standings[4].pointsFor, 16);
  assert.equal(standings[1].pointsFor, 0);
  assert.equal(standings[2].pointsFor, 0);
  assert.notEqual(standings[3].npd, 0);
  assert.equal(standings[1].npd, 0);
});

// ---------------------------------------------------------------------------
// H. No RP
// ---------------------------------------------------------------------------

test('H: reconstructed standings do not calculate or reset RP — an input rp value passes through untouched', () => {
  const players = [
    { id: 1, name: 'A', elo: 1600, rp: 42 },
    { id: 2, name: 'B', elo: 1600 } // no rp field at all on input
  ];
  const rounds = {
    1: [{ id: 'm1', p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1600 }, r1: 5, r2: 1, done: true, cancelled: false, bye: false }]
  };
  const standings = reconstructStandingsBeforeRound({
    players, startingRoster: players, rounds, roundLimit: 2, config
  });
  // rp is neither reset nor recalculated — whatever was on the input player object survives unchanged.
  assert.equal(standings[1].rp, 42);
  assert.equal('rp' in standings[2], false);
});

// ---------------------------------------------------------------------------
// I. Starting-GBR precedence and sequential match dependency
// ---------------------------------------------------------------------------

test('I: startingRoster GBR wins over the tournament player\'s own elo, and a second match uses the first match\'s resulting GBR', () => {
  // Player 1's tournament-player elo (1500) deliberately differs from their
  // startingRoster elo (1800) — the roster value must win at initialization,
  // exactly like the pre-M2F `players.find(pl => pl.id === p.id)?.elo || p.elo`.
  const players = [
    { id: 1, name: 'P1', elo: 1500 },
    { id: 2, name: 'P2', elo: 1600 },
    { id: 3, name: 'P3', elo: 1600 }
  ];
  const startingRoster = [
    { id: 1, elo: 1800 },
    { id: 2, elo: 1600 },
    { id: 3, elo: 1600 }
  ];
  const rounds = {
    1: [{ id: 'm1', p1: { id: 1, elo: 1800 }, p2: { id: 2, elo: 1600 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false }],
    2: [{ id: 'm2', p1: { id: 1, elo: 1800 }, p2: { id: 3, elo: 1600 }, r1: 5, r2: 1, done: true, cancelled: false, bye: false }]
  };

  const standings = reconstructStandingsBeforeRound({ players, startingRoster, rounds, roundLimit: 3, config });

  // Sequential dependency: round 2's GBR change for player 1 was computed
  // from the GBR round 1 produced (1803.2598428990225), not from a re-read of
  // startingRoster (1800) and not from the stale tournament-player elo (1500).
  closeTo(standings[1].elo, 1809.673299422167);
  assert.equal(standings[1].mp, 2);
  assert.equal(standings[1].games, 2);
  assert.equal(standings[1].perfCount, 2);
  assert.deepEqual(standings[1].opps, [2, 3]);
});
