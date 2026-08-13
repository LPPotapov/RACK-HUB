// Pairing generation (M2L): a faithful, pure extraction of
// PoolTournamentApp.jsx's current `createPairings()` — the single function
// both `startTournament()` and `nextRound()` call to produce a round's
// matches. Extracted only because M2L's canonical `startTournament`
// application command needs to generate Round 1 without depending on React;
// this is NOT a pairing redesign — every branch, order, and constant below
// is copied from the current component implementation, verified by direct
// inspection before writing this file. AGENTS.md places "Swiss-style
// pairing; bye eligibility/selection" in the domain/engine layer, so this is
// where it belongs once anything outside the component needs it.
//
// Pure: no React, no localStorage, no DOM/browser APIs. Closures the
// component previously read implicitly (`allRounds`, `tableNumbers`,
// `config`) are now explicit parameters.
//
// Deliberately NOT reproduced: `console.log`/`console.warn`/`console.error`
// calls in the original — these are non-observable diagnostic output, not
// tournament state (see AGENTS.md's "clearly irrelevant implementation
// detail" guidance).

import { pairingCost, selectEligibleBye } from './fixedRackBbs.js';
import { assignStraightPoolTierTargets, getSP, getStraightPoolTargetForMatch, isStraightPool } from './straightPool14_1.js';

// generatePairings(sortedPlayers, options) -> Match[] | null
//
// `sortedPlayers` must already be in the order the caller wants used for
// Round 1 direct-pairing seed methods (random/manual/cross_elo) — this
// function does not sort; `startTournament()` (and its canonical M2L
// counterpart) sorts before calling, exactly as today.
//
// options:
//   startTableIndex - default 0, matches createPairings()'s default
//   roundNum        - default 1
//   seedMethod      - only affects behavior when roundNum === 1; any value
//                      other than 'random'/'cross_elo'/'manual' (including
//                      'elo' and null) falls through to Swiss/cost-based
//                      pairing, exactly like current code
//   allRounds       - default {} — used only to build bye history for rounds
//                      strictly before roundNum; a fresh Round 1 call always
//                      passes {} (or is safely omitted)
//   tableNumbers    - default [] — component's "Configure Table Numbers"
//                      state; tbl falls back to a 1-based sequential index
//                      when absent, exactly like current code
//   config          - required; only config.format/config.straightPool are
//                      read (via isStraightPool/getSP), same as current code
//
// Returns `null` exactly when current code does — no legal bye is available
// for an odd player count (whitepaper §9.2) — signaling the caller must not
// commit any round state, the same contract createPairings() already has.
export const generatePairings = (
  sortedPlayers,
  { startTableIndex = 0, roundNum = 1, seedMethod = null, allRounds = {}, tableNumbers = [], config }
) => {
  const matches = [];
  const players = [...sortedPlayers];

  // Build bye history (who has had a bye in a round STRICTLY BEFORE roundNum).
  const byeHistory = new Set();
  players.forEach((p) => {
    Object.entries(allRounds).forEach(([roundKey, roundMatches]) => {
      if (Number(roundKey) >= roundNum) return;
      (roundMatches || []).forEach((m) => {
        if (m.bye && m.p1.id === p.id) byeHistory.add(p.id);
      });
    });
  });

  // Newly-added players protected from an immediate bye: only players who
  // joined AFTER tournament start (joinedRound > 1) in this same round.
  const newPlayerIds = new Set(
    players
      .filter((p) => (p.joinedRound || 1) > 1 && p.joinedRound === roundNum)
      .map((p) => p.id)
  );

  const paired = new Set();

  // STEP 1: deterministic bye assignment (odd player count).
  if (players.length % 2 === 1) {
    const candidate = selectEligibleBye(players, byeHistory, newPlayerIds);
    if (candidate) {
      paired.add(candidate.id);
      matches.push({
        p1: candidate,
        p2: { id: 'bye', name: 'FREILOS', elo: 1300 },
        bye: true
      });
    }
    // Whitepaper §9.2: repeated byes are illegal. No eligible player exists.
    if (!candidate) {
      return null;
    }
  }

  // ROUND 1 SPECIAL SEEDING: random/cross_elo/manual use direct pairing.
  if (roundNum === 1 && (seedMethod === 'random' || seedMethod === 'cross_elo' || seedMethod === 'manual')) {
    const unpaired = players.filter((p) => !paired.has(p.id));

    if (seedMethod === 'random' || seedMethod === 'manual') {
      for (let i = 0; i < unpaired.length - 1; i += 2) {
        matches.push({ p1: unpaired[i], p2: unpaired[i + 1], bye: false });
        paired.add(unpaired[i].id);
        paired.add(unpaired[i + 1].id);
      }
    } else if (seedMethod === 'cross_elo') {
      const halfPoint = Math.floor(unpaired.length / 2);
      const topHalf = unpaired.slice(0, halfPoint);
      const bottomHalf = unpaired.slice(halfPoint);
      for (let i = 0; i < topHalf.length; i++) {
        matches.push({ p1: topHalf[i], p2: bottomHalf[i], bye: false });
        paired.add(topHalf[i].id);
        paired.add(bottomHalf[i].id);
      }
    }
    // Skip STEP 2/3 for these Round 1 seeding methods.
  } else {
    // NORMAL SWISS PAIRING (Rounds >= 2, or Round 1 with 'elo'/unrecognized seeding).

    // STEP 2: pair new players by closest ELO/avgPerf match.
    players.forEach((p1) => {
      if (paired.has(p1.id)) return;
      if (!newPlayerIds.has(p1.id)) return;

      let bestOpponent = null;
      let smallestDiff = Infinity;

      for (let j = 0; j < players.length; j++) {
        const p2 = players[j];
        if (paired.has(p2.id)) continue;
        if (p2.id === p1.id) continue;
        if ((p1.opps || []).includes(p2.id)) continue;

        const p1Rating = p1.avgPerf || p1.elo;
        const p2Rating = p2.avgPerf || p2.elo;
        const diff = Math.abs(p1Rating - p2Rating);

        if (diff < smallestDiff) {
          smallestDiff = diff;
          bestOpponent = p2;
        }
      }

      if (bestOpponent) {
        paired.add(p1.id);
        paired.add(bestOpponent.id);
        matches.push({ p1, p2: bestOpponent, bye: false });
      }
    });

    // STEP 3: cost-based greedy pairing for remaining players.
    for (let i = 0; i < players.length; i++) {
      if (paired.has(players[i].id)) continue;

      const p1 = players[i];
      let bestOpponent = null;
      let lowestCost = Infinity;

      for (let j = i + 1; j < players.length; j++) {
        if (paired.has(players[j].id)) continue;

        const p2 = players[j];
        const cost = pairingCost(p1, p2);

        if (cost < lowestCost) {
          lowestCost = cost;
          bestOpponent = p2;
        }
      }

      if (bestOpponent) {
        paired.add(p1.id);
        paired.add(bestOpponent.id);
        matches.push({ p1, p2: bestOpponent, bye: false });
      } else {
        // Last resort: pair with anyone remaining (even if repeat).
        let fallbackOpponent = null;
        for (let j = i + 1; j < players.length; j++) {
          if (paired.has(players[j].id)) continue;
          fallbackOpponent = players[j];
          break;
        }

        if (fallbackOpponent) {
          paired.add(p1.id);
          paired.add(fallbackOpponent.id);
          matches.push({ p1, p2: fallbackOpponent, bye: false, repeat: true });
        }
        // else: nothing left to pair this player with (should not occur with
        // an even remaining count) — current code only logs an error here.
      }
    }
  }

  // v1.92: in 14.1 mode, compute tier targets for this round (based on the
  // standings order the caller sorted players into) and stamp each match.
  const sp = getSP(config.straightPool);
  const straightPool = isStraightPool(config.format);
  const tierMap = straightPool ? assignStraightPoolTierTargets(sortedPlayers, roundNum, sp) : null;

  return matches.map((pair, idx) => {
    const base = {
      id: Date.now() + idx,
      p1: pair.p1,
      p2: pair.p2,
      // Whitepaper §9.3: a bye awards 1 MP but contributes no racks. Stored
      // as r1=0, r2=0, done=true, bye=true so it is never shown/treated as a
      // 6-0 result.
      r1: 0,
      r2: 0,
      done: pair.bye,
      cancelled: false,
      bye: pair.bye,
      tbl: tableNumbers[startTableIndex + idx] || (startTableIndex + idx + 1)
    };
    if (straightPool) {
      base.format = 'straight_pool_14_1';
      base.target = pair.bye ? 0 : getStraightPoolTargetForMatch(pair.p1, pair.p2, tierMap, sp);
      base.p1Points = 0;
      base.p2Points = 0;
      base.innings = 0;
      base.p1HighRun = 0;
      base.p2HighRun = 0;
    } else {
      base.format = 'fixed_rack';
    }
    return base;
  });
};
