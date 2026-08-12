export const expectedScore = (gbrA, gbrB, d) => 1 / (1 + Math.pow(10, (gbrB - gbrA) / d));

export const matchPoints = (racksFor, racksAgainst, bye = false) => {
  if (bye) return 1;
  return racksFor > racksAgainst ? 1 : racksFor < racksAgainst ? 0 : 0.5;
};

export const gbrChange = (gbrA, gbrB, racksA, racksB, { d, k_m, k_r }) => {
  if (racksA + racksB === 0) return 0;
  const expected = expectedScore(gbrA, gbrB, d);
  return k_m * (matchPoints(racksA, racksB) - expected)
    + k_r * (racksA / (racksA + racksB) - expected);
};

export const performanceGbr = (opponentGbr, racksFor, racksAgainst, d) => {
  if (racksFor + racksAgainst === 0) return opponentGbr;
  const score = racksFor / (racksFor + racksAgainst);
  if (score === 1) return opponentGbr + 3 * d;
  if (score === 0) return opponentGbr - 3 * d;
  return Math.round(opponentGbr + d * Math.log10(score / (1 - score)));
};

export const averagePerformance = (total, count) => count > 0 ? total / count : 0;

// Legacy composite display value (MP + PERF/10000). No longer used to order
// Classic standings (see compareFixedRackStandings); kept only for the
// informational "Score" UI figure.
export const classicStandingScore = (mp, averagePerf) => mp + averagePerf / 10000;

// Whitepaper §Classic standings: strict lexicographic MP -> PERF -> ID.
// MP must always dominate PERF, regardless of PERF magnitude.
export const compareFixedRackStandings = (a, b, rankingSystem) => {
  const perfA = averagePerformance(a.perf, a.perfCount);
  const perfB = averagePerformance(b.perf, b.perfCount);
  if (rankingSystem === 'racks') {
    if (b.mp !== a.mp) return b.mp - a.mp;
    const rdA = (a.racksWon || 0) - (a.racksLost || 0);
    const rdB = (b.racksWon || 0) - (b.racksLost || 0);
    if (rdB !== rdA) return rdB - rdA;
    if (perfB !== perfA) return perfB - perfA;
    return a.id - b.id;
  }
  if (b.mp !== a.mp) return b.mp - a.mp;
  if (perfB !== perfA) return perfB - perfA;
  return a.id - b.id;
};

export const compareFixedRackPairingOrder = (a, b) => {
  if (b.mp !== a.mp) return b.mp - a.mp;
  const perfA = averagePerformance(a.perf, a.perfCount);
  const perfB = averagePerformance(b.perf, b.perfCount);
  if (perfB !== perfA) return perfB - perfA;
  return a.id - b.id;
};

export const pairingCost = (a, b) => {
  const mpGap = Math.abs((a.mp || 0) - (b.mp || 0));
  const perfGap = Math.abs((a.avgPerf || a.elo) - (b.avgPerf || b.elo));
  const repeatPenalty = (a.opps || []).includes(b.id) ? 100000 : 0;
  return repeatPenalty + mpGap * 10000 + perfGap;
};

export const selectEligibleBye = (sortedPlayers, priorByeIds, newPlayerIds) => {
  for (let i = sortedPlayers.length - 1; i >= 0; i--) {
    const player = sortedPlayers[i];
    if (!priorByeIds.has(player.id) && !newPlayerIds.has(player.id)) return player;
  }
  return null;
};

export const initialReplayPlayer = (player, startingGbr = player.elo) => ({
  ...player, mp: 0, perf: 0, perfCount: 0, elo: startingGbr, games: 0,
  opps: [], rp: 0, racksWon: 0, racksLost: 0
});

export const applyFixedRackMatch = (players, match, config, calculatePrestige = () => 0) => {
  if (!match.done || match.cancelled) return players;
  const mpA = matchPoints(match.r1, match.r2, match.bye);
  if (match.bye) {
    const rpA = calculatePrestige(mpA, 0);
    return players.map((p) => p.id === match.p1.id
      ? { ...p, mp: p.mp + mpA, games: p.games + 1, rp: p.rp + rpA }
      : p);
  }
  const playerA = players.find((p) => p.id === match.p1.id);
  const playerB = players.find((p) => p.id === match.p2.id);
  const beforeA = playerA.elo;
  const beforeB = playerB.elo;
  const change = gbrChange(beforeA, beforeB, match.r1, match.r2, config);
  const perfA = performanceGbr(beforeB, match.r1, match.r2, config.d);
  const perfB = performanceGbr(beforeA, match.r2, match.r1, config.d);
  const mpB = matchPoints(match.r2, match.r1);
  const rpA = calculatePrestige(mpA, change);
  const rpB = calculatePrestige(mpB, -change);
  return players.map((p) => {
    if (p.id === match.p1.id) return {
      ...p, mp: p.mp + mpA, perf: p.perf + perfA, perfCount: p.perfCount + 1,
      elo: p.elo + change, games: p.games + 1,
      opps: p.opps.includes(match.p2.id) ? p.opps : [...p.opps, match.p2.id],
      rp: p.rp + rpA, racksWon: p.racksWon + match.r1, racksLost: p.racksLost + match.r2
    };
    if (p.id === match.p2.id) return {
      ...p, mp: p.mp + mpB, perf: p.perf + perfB, perfCount: p.perfCount + 1,
      elo: p.elo - change, games: p.games + 1,
      opps: p.opps.includes(match.p1.id) ? p.opps : [...p.opps, match.p1.id],
      rp: p.rp + rpB, racksWon: p.racksWon + match.r2, racksLost: p.racksLost + match.r1
    };
    return p;
  });
};

export const replayFixedRackHistory = (players, rounds, config, calculatePrestige = () => 0) => {
  let current = players.map((p) => initialReplayPlayer(p, p.startingGbr ?? p.elo));
  for (const round of Object.keys(rounds).map(Number).sort((a, b) => a - b)) {
    for (const match of rounds[round] || []) {
      current = applyFixedRackMatch(current, match, config, calculatePrestige);
    }
  }
  return current;
};
