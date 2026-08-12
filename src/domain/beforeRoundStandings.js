import { fixedRackMatchOutcome } from './fixedRackBbs.js';
import { getSP, straightPoolMatchOutcome } from './straightPool14_1.js';

// Reconstruct each eligible player's tournament state as of strictly BEFORE
// `roundLimit` (i.e. through all completed, non-cancelled matches in rounds
// 1..roundLimit-1). Used to prepare accurate pairing input for a not-yet-
// generated round — NOT a general-purpose recalculation (see recalc() for
// that). Mirrors the per-match domain calculations recalc() uses, but:
//
//   - only includes players eligible as of roundLimit (not `removed`, and
//     already `joinedRound`-eligible) in the returned standings;
//   - tolerates a historical opponent being absent from that eligible set —
//     the match's own stored pre-match GBR snapshot (m.p1.elo / m.p2.elo) is
//     used as that opponent's GBR so the still-eligible player is still
//     scored correctly, and an absent opponent's id is NOT added to the
//     surviving player's opponent history (matching the existing guard);
//   - does not track or reset RP/Prestige — its only consumer is pairing
//     input, which never reads RP.
//
// Pure: no React, no localStorage, no player-array lookup beyond what's
// passed in explicitly.
//
// `players` is the tournament roster being reconstructed. `startingRoster` is
// the separate source roster (e.g. the club/global player list) originally
// used to resolve each player's starting GBR; looked up by strict `===` id
// equality (first match wins), exactly like the pre-extraction component code
// (`players.find(pl => pl.id === p.id)?.elo || p.elo`) — not via an id-keyed
// object, which would coerce numeric/string ids together and let a later
// duplicate id silently overwrite an earlier one.
export const reconstructStandingsBeforeRound = ({ players, startingRoster, rounds, roundLimit, config }) => {
  const standings = {};
  players
    .filter((p) => !p.removed && (p.joinedRound || 1) <= roundLimit)
    .forEach((p) => {
      const startElo = startingRoster.find((pl) => pl.id === p.id)?.elo || p.elo;
      standings[p.id] = {
        ...p,
        mp: 0, perf: 0, perfCount: 0, elo: startElo, games: 0,
        racksWon: 0, racksLost: 0, opps: [],
        pointsFor: 0, pointsAgainst: 0, inningsTotal: 0, npd: 0, hs: 0, hgd: 0
      };
    });

  const sp = getSP(config.straightPool);

  for (let r = 1; r < roundLimit; r++) {
    (rounds[r] || []).forEach((m) => {
      if (!m.done || m.cancelled) return;
      const p1Data = standings[m.p1.id];
      const p2Data = standings[m.p2.id];

      // ---- GBR_14.1 experimental match ----
      if (m.format === 'straight_pool_14_1' && !m.bye) {
        const PA = Number(m.p1Points) || 0, PB = Number(m.p2Points) || 0;
        const inn = Number(m.innings) || 0;
        const HRA = Number(m.p1HighRun) || 0, HRB = Number(m.p2HighRun) || 0;
        const g1 = p1Data ? p1Data.elo : m.p1.elo;
        const g2 = p2Data ? p2Data.elo : m.p2.elo;
        const outcome = straightPoolMatchOutcome(g1, g2, {
          p1Points: PA, p2Points: PB, innings: inn, p1HighRun: HRA, p2HighRun: HRB, target: m.target
        }, { d: config.d, k_m: config.k_m, sp });
        if (p1Data) {
          p1Data.mp += outcome.mpA;
          p1Data.games++; p1Data.elo += outcome.change;
          p1Data.perf += outcome.perfA; p1Data.perfCount++;
          p1Data.pointsFor += PA; p1Data.pointsAgainst += PB; p1Data.inningsTotal += inn;
          p1Data.npd += outcome.npdA; p1Data.hs = Math.max(p1Data.hs, HRA);
          p1Data.hgd = Math.max(p1Data.hgd, outcome.gdA);
          if (p2Data && !p1Data.opps.includes(m.p2.id)) p1Data.opps.push(m.p2.id);
        }
        if (p2Data) {
          p2Data.mp += outcome.mpB;
          p2Data.games++; p2Data.elo -= outcome.change;
          p2Data.perf += outcome.perfB; p2Data.perfCount++;
          p2Data.pointsFor += PB; p2Data.pointsAgainst += PA; p2Data.inningsTotal += inn;
          p2Data.npd += outcome.npdB; p2Data.hs = Math.max(p2Data.hs, HRB);
          p2Data.hgd = Math.max(p2Data.hgd, outcome.gdB);
          if (p1Data && !p2Data.opps.includes(m.p1.id)) p2Data.opps.push(m.p1.id);
        }
        return;
      }

      // ---- Bye ----
      if (m.bye) {
        if (p1Data) { p1Data.mp += 1; p1Data.games++; } // bye = +1 MP, no other stats
        return;
      }

      // ---- Fixed-rack match ----
      const g1 = p1Data ? p1Data.elo : m.p1.elo;
      const g2 = p2Data ? p2Data.elo : m.p2.elo;
      const outcome = fixedRackMatchOutcome(m.r1, m.r2, g1, g2, config);
      if (p1Data) {
        p1Data.mp += outcome.mpA;
        p1Data.games++; p1Data.elo += outcome.change;
        p1Data.perf += outcome.perfA; p1Data.perfCount++;
        p1Data.racksWon += m.r1; p1Data.racksLost += m.r2;
        if (p2Data && !p1Data.opps.includes(m.p2.id)) p1Data.opps.push(m.p2.id);
      }
      if (p2Data) {
        p2Data.mp += outcome.mpB;
        p2Data.games++; p2Data.elo -= outcome.change;
        p2Data.perf += outcome.perfB; p2Data.perfCount++;
        p2Data.racksWon += m.r2; p2Data.racksLost += m.r1;
        if (p1Data && !p2Data.opps.includes(m.p1.id)) p2Data.opps.push(m.p1.id);
      }
    });
  }
  return standings;
};
