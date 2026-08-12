// EXPERIMENTAL: GBR_14.1 straight-pool signal/rating model, not calibrated.
// Isolated from stable fixed-rack BBS behavior (src/fixedRackBbs.js).
// Formulas are unchanged from the pre-extraction PoolTournamentApp.jsx
// implementation; only the config/closure inputs were made explicit.
import { expectedScore } from './fixedRackBbs.js';

export const STRAIGHT_POOL_DEFAULTS = {
  enabled: false,
  label: 'GBR_14.1 Experimental',
  startTarget: 40,
  tieringStartsRound: 2,
  tierTargets: [50, 40, 30],
  targetReference: 40,
  useTargetScaledK: true,
  k_14_1: 20,
  marginWeight: 0.60,
  bpiWeight: 0.30,
  highRunWeight: 0.10,
  standingsOrder: 'mp_perf_npd'
};

// Merge the active straight-pool config with safe defaults (old snapshots may lack it)
export const getSP = (straightPoolConfig) => ({ ...STRAIGHT_POOL_DEFAULTS, ...(straightPoolConfig || {}) });

// True when the tournament is running in 14.1 experimental mode
export const isStraightPool = (format) => format === 'straight_pool_14_1';

export const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Normalize the three 14.1 weights to sum to 1 (fallback to defaults if invalid)
export const normalizeWeights = (weights) => {
  const m = Number(weights?.marginWeight) || 0;
  const b = Number(weights?.bpiWeight) || 0;
  const h = Number(weights?.highRunWeight) || 0;
  const sum = m + b + h;
  if (sum <= 0) return { marginWeight: 0.60, bpiWeight: 0.30, highRunWeight: 0.10 };
  return { marginWeight: m / sum, bpiWeight: b / sum, highRunWeight: h / sum };
};

// Compute the 14.1 observed signals from Player A's perspective
export const calcStraightPoolSignals = (p1Points, p2Points, innings, p1HighRun, p2HighRun, target, weights) => {
  const w = normalizeWeights(weights);
  const T = target > 0 ? target : 1;
  const PA = Number(p1Points) || 0, PB = Number(p2Points) || 0;
  const inn = Number(innings) || 0;
  const HRA = Number(p1HighRun) || 0, HRB = Number(p2HighRun) || 0;

  const sMatch = PA > PB ? 1 : PA === PB ? 0.5 : 0;
  const sMargin = clamp01(0.5 + (PA - PB) / (2 * T));
  const bpiA = inn > 0 ? PA / inn : 0;
  const bpiB = inn > 0 ? PB / inn : 0;
  const sBpi = (bpiA + bpiB) > 0 ? bpiA / (bpiA + bpiB) : 0.5;
  const sHr = (HRA + HRB) > 0 ? HRA / (HRA + HRB) : 0.5;
  const s141 = clamp01(w.marginWeight * sMargin + w.bpiWeight * sBpi + w.highRunWeight * sHr);
  return { sMatch, sMargin, sBpi, sHr, s141 };
};

// 14.1 PERF: opponent GBR adjusted by the inverse-logistic of the 14.1 signal (±3d cap)
export const calcStraightPoolPerf = (opponentGbr, s141, d) => {
  if (s141 >= 0.999) return opponentGbr + 3 * d;
  if (s141 <= 0.001) return opponentGbr - 3 * d;
  return Math.round(opponentGbr + d * Math.log10(s141 / (1 - s141)));
};

// 14.1 GBR change (zero-sum, from Player 1 perspective). matchData carries
// points/innings/highRuns/target. EXPERIMENTAL GBR_14.1 logic.
export const calcStraightPoolGbrChange = (gbr1, gbr2, matchData, { d, k_m, sp }) => {
  const target = matchData.target || sp.startTarget;
  const { sMatch, s141 } = calcStraightPoolSignals(
    matchData.p1Points, matchData.p2Points, matchData.innings,
    matchData.p1HighRun, matchData.p2HighRun, target, sp
  );
  const eA = expectedScore(gbr1, gbr2, d);
  const dMatch = k_m * (sMatch - eA);
  const kEff = sp.useTargetScaledK
    ? sp.k_14_1 * Math.sqrt(target / (sp.targetReference || 40))
    : sp.k_14_1;
  const d141 = kEff * (s141 - eA);
  return dMatch + d141;
};

// Normalized point differential for one match (race targets vary, so normalize by T)
export const calcNPD = (pointsFor, pointsAgainst, target) => {
  const T = target > 0 ? target : 1;
  return ((Number(pointsFor) || 0) - (Number(pointsAgainst) || 0)) / T;
};

// Assign a race target to every player by tier, based on current standings order.
// Round < tieringStartsRound: everyone uses startTarget. Otherwise split into
// tierTargets.length tiers; extra players go to higher tiers first.
export const assignStraightPoolTierTargets = (sortedPlayers, roundNum, sp) => {
  const tierMap = {};
  if (roundNum < (sp.tieringStartsRound || 2)) {
    sortedPlayers.forEach(p => { tierMap[p.id] = sp.startTarget; });
    return tierMap;
  }
  const targets = (sp.tierTargets && sp.tierTargets.length) ? sp.tierTargets : [50, 40, 30];
  const m = targets.length;
  const n = sortedPlayers.length;
  const base = Math.floor(n / m);
  let extra = n - base * m; // remainder distributed to higher tiers first
  let idx = 0;
  for (let t = 0; t < m; t++) {
    const size = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    for (let k = 0; k < size && idx < n; k++, idx++) {
      tierMap[sortedPlayers[idx].id] = targets[t];
    }
  }
  for (; idx < n; idx++) tierMap[sortedPlayers[idx].id] = targets[m - 1];
  return tierMap;
};

// Match target = max of the two players' tier targets (preserve competitive resolution)
export const getStraightPoolTargetForMatch = (p1, p2, tierMap, sp) => {
  const t1 = (tierMap && tierMap[p1.id]) || sp.startTarget;
  const t2 = (tierMap && tierMap[p2.id]) || sp.startTarget;
  return Math.max(t1, t2);
};

// Compare players for 14.1 final standings / pairing.
// Classic 14.1:       MP -> 14.1 PERF -> Point Diff -> GD -> HS -> ID
// Point Differential: MP -> Point Diff -> 14.1 PERF -> GD -> HS -> ID
export const compareStraightPool = (a, b, rankingSystem) => {
  if ((b.mp || 0) !== (a.mp || 0)) return (b.mp || 0) - (a.mp || 0);
  const perfA = a.perfCount > 0 ? a.perf / a.perfCount : 0;
  const perfB = b.perfCount > 0 ? b.perf / b.perfCount : 0;
  const pdA = (a.pointsFor || 0) - (a.pointsAgainst || 0);
  const pdB = (b.pointsFor || 0) - (b.pointsAgainst || 0);
  const gdA = a.inningsTotal > 0 ? a.pointsFor / a.inningsTotal : 0;
  const gdB = b.inningsTotal > 0 ? b.pointsFor / b.inningsTotal : 0;

  if (rankingSystem === 'racks') {
    if (pdB !== pdA) return pdB - pdA;          // Point Diff first
    if (perfB !== perfA) return perfB - perfA;  // then PERF
  } else {
    if (perfB !== perfA) return perfB - perfA;  // PERF first (Classic)
    if (pdB !== pdA) return pdB - pdA;          // then Point Diff
  }
  if (gdB !== gdA) return gdB - gdA;            // GD
  if ((b.hs || 0) !== (a.hs || 0)) return (b.hs || 0) - (a.hs || 0); // HS
  return a.id - b.id;                            // ID
};
