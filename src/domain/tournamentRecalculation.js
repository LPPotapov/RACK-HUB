// Full-history tournament recalculation (M2M-A): a pure extraction of
// PoolTournamentApp.jsx's recalc() — the function that reconstructs every
// current tournament.players entry's derived numeric truth (MP, GBR, PERF,
// racks, RP, 14.1 aggregates) by replaying stored round history from each
// player's starting GBR. Not a redesign — every behavior below (including
// its known quirks) matches recalc() verified by direct source inspection,
// not assumption.
//
// HARD PRODUCT RULE: recalculation != re-pairing. `rounds` is a read-only
// historical input here — this module never adds, removes, or reorders a
// match, player snapshot, table assignment, or target. It only computes new
// DERIVED numbers for `players`. A future "Rebuild Round X" (not
// implemented) is the only thing allowed to regenerate pairings.
//
// =============================================================================
// CHARACTERIZATION (verified against PoolTournamentApp.jsx's recalc(), not
// assumed from prior comments)
// =============================================================================
//
// Starting GBR source: `roster` (the component's global `players` state,
// i.e. canonical `tournament.roster` — NOT `tournament.players`). recalc()
// builds a plain lookup object keyed by id:
//   const startElos = {}; players.forEach(p => startElos[p.id] = p.elo);
//   ... elo: startElos[p.id] || p.elo ...
// This is preserved EXACTLY, not replaced with a `.find()`/Map lookup:
//   - plain-object bracket access coerces every key to a string, so a
//     roster containing BOTH a numeric id 5 and a string id '5' would
//     collide into the same `startElos` property — LAST WRITE WINS (the
//     later roster entry silently overwrites the earlier one's stored elo).
//     This is different from reconstructStandingsBeforeRound()'s starting-
//     GBR lookup (`startingRoster.find(pl => pl.id === p.id)`), which uses
//     strict `===` and FIRST-match semantics — a genuine, mechanically
//     observed difference between the two existing legacy-derived
//     behaviors (see docs/ARCHITECTURE.md).
//   - `|| p.elo` (OR, not `??`) falls back to the player's own CURRENT elo
//     value (not their original starting elo) whenever `startElos[p.id]` is
//     falsy — including when the player is entirely absent from `roster`
//     (removed from the global roster after joining the tournament) or
//     when their roster elo happens to be `0`.
//
// Steady-state player shape: every replay pass resets EVERY accumulated
// field on EVERY player, regardless of tournament format:
//   mp, perf, perfCount, elo (from startElos, see above), games, opps,
//   rp, racksWon, racksLost, pointsFor, pointsAgainst, inningsTotal, npd,
//   hs, hgd
// — even for a purely fixed-rack tournament, the 14.1 aggregate fields are
// always present and zeroed (matching recalc()'s own unconditional reset;
// this is NOT format-conditional). Every other existing field on the input
// `players` entry (id, name, removed, joinedRound, any other ad-hoc field)
// survives via spread, untouched by this reset.
//
// Round/match replay order: rounds are replayed strictly `1..currentRound`
// inclusive (`for (let round = 1; round <= currentRound; round++)`), NOT
// "every key present in `rounds`" — a round stored below 1 (see M2L's
// artificial-prior-bye characterization) or above `currentRound` is never
// replayed, exactly like current recalc(). A round number with no entry in
// `rounds` is treated as zero matches (`rounds[round] || []`), not an
// error. Within a round, matches replay in stored array order — GBR
// evolves sequentially match-by-match, never computed from final/latest
// values.
//
// Per-match skip: a match is replayed only when `match.done && !match.cancelled`
// — an incomplete (`done: false`) or cancelled match contributes nothing.
//
// Fixed-rack branch: delegates to `applyFixedRackMatch()` (fixedRackBbs.js)
// — the SAME function recalc() itself calls — for both genuine fixed-rack
// matches AND any match without `format` at all (Manual Pairing Editor
// matches; recalc()'s format check is `match.format === 'straight_pool_14_1'`,
// so an absent `format` always falls through to the fixed-rack path,
// exactly like this module). `applyFixedRackMatch()` already reproduces
// current bye semantics (+1 MP, no racks/GBR/PERF/opponent, RP still
// accrues) and its own `done`/`cancelled` skip guard.
//
// 14.1 branch (`match.format === 'straight_pool_14_1' && !match.bye`):
// computed via `straightPoolMatchOutcome()` (straightPool14_1.js — the same
// pure function recalc() calls), reading `match.target` AS STORED ON THE
// MATCH (never recomputed from current config — see "target" below), with
// RP, `opps`, `pointsFor`/`pointsAgainst`/`inningsTotal`/`npd`/`hs`/`hgd`
// accrued here exactly as recalc() accrues them inline (these are not part
// of `straightPoolMatchOutcome()`'s own return value by design — see that
// function's docstring). A 14.1-formatted BYE match does NOT take this
// branch (`!match.bye` excludes it) — it falls through to the fixed-rack
// bye path above instead, exactly like recalc(): a 14.1 bye gets +1 MP,
// games+1, RP, and NOTHING ELSE (no 14.1 aggregate field is touched, no
// opponent added, FREILOS is never treated as a real opponent in either
// format).
//
// Target: `match.target` is read exactly as stored on the historical match
// — NEVER recomputed from the current active `config.straightPool`
// tier/target settings. Only the WEIGHTS/K-values used to interpret that
// stored target (`sp = getSP(config.straightPool)`) come from the CURRENT
// active config.
//
// RP (Prestige): `rp_per_round + matchPoints*rp_per_mp + (eloChange>0 ?
// eloChange*rp_elo_multiplier : 0)` when `config.use_rp`, else 0 — computed
// fresh per match from the CURRENT active config (see "config history"
// below), for both fixed-rack and 14.1 matches, including byes (bye RP
// uses `eloChange: 0`, so only `rp_per_round + matchPoints(1)*rp_per_mp`
// applies). Symmetric: both players' RP is computed the same way, using
// their own match points and their own (opposite-signed) GBR change.
//
// CURRENT LEGACY COMPATIBILITY — config history: recalc() has NO per-round
// historical config snapshot. Every round, however long ago it was played,
// is recalculated using whatever `config`/`config.straightPool` is CURRENTLY
// active at the moment recalc() runs — including `d`/`k_m`/`k_r`/`use_rp`/
// all 14.1 weights. Changing the active config retroactively changes the
// derived numbers (GBR/PERF/RP/etc.) for every already-played round, not
// just future ones. This is preserved exactly, not "fixed" — a future
// RACK HUB will preserve round-specific effective settings (see
// docs/ARCHITECTURE.md's FUTURE note), but that does not exist yet.
//
// Join/remove: `removed` players are NOT filtered out or skipped — recalc()
// (and this module) replays every match in `rounds` regardless of any
// player's `removed` flag, so a removed player's historical stats remain
// fully computed (only future pairing excludes them — a separate, already-
// implemented concern, not this module's). `joinedRound` is not read here
// at all; it is preserved via spread only. There is no eligibility gating
// in recalc() itself (unlike reconstructStandingsBeforeRound(), which DOES
// gate by `joinedRound`/`removed` for its different, pairing-preparation
// purpose — a genuine, deliberate difference between the two functions, not
// an inconsistency to resolve here).
//
// Discovered quirk, preserved not smoothed over: if a match references a
// player id absent from the working `players` array (structurally possible,
// though not reachable through any current UI action — `performDeletePlayer()`
// strips a fully-deleted player's matches from every round, not just future
// ones), `applyFixedRackMatch()`'s/this module's 14.1 branch's `.find()`
// calls return `undefined`, and the next property access throws a
// TypeError — exactly like current recalc() would. No defensive fallback is
// added; that would be inventing behavior legacy does not have.
import { applyFixedRackMatch } from './fixedRackBbs.js';
import { getSP, straightPoolMatchOutcome } from './straightPool14_1.js';

const calcRoundRP = (matchPoints, eloChange, config) => {
  if (!config.use_rp) return 0;
  const rpForRound = config.rp_per_round;
  const rpForMP = matchPoints * config.rp_per_mp;
  const rpForElo = eloChange > 0 ? eloChange * config.rp_elo_multiplier : 0;
  return rpForRound + rpForMP + rpForElo;
};

// Applies a single non-bye 14.1 match to the replay array, mirroring
// recalc()'s inline 14.1 branch exactly — RP/opps/14.1-aggregate accrual
// live here (not in straightPoolMatchOutcome(), which deliberately excludes
// them; see straightPool14_1.js).
const applyStraightPoolMatch = (players, match, config) => {
  const p1Cur = players.find((p) => p.id === match.p1.id);
  const p2Cur = players.find((p) => p.id === match.p2.id);
  const g1 = p1Cur.elo;
  const g2 = p2Cur.elo;
  const PA = Number(match.p1Points) || 0;
  const PB = Number(match.p2Points) || 0;
  const inn = Number(match.innings) || 0;
  const HRA = Number(match.p1HighRun) || 0;
  const HRB = Number(match.p2HighRun) || 0;

  const sp = getSP(config.straightPool);
  const outcome = straightPoolMatchOutcome(g1, g2, {
    p1Points: PA, p2Points: PB, innings: inn, p1HighRun: HRA, p2HighRun: HRB, target: match.target
  }, { d: config.d, k_m: config.k_m, sp });

  const rp1 = calcRoundRP(outcome.mpA, outcome.change, config);
  const rp2 = calcRoundRP(outcome.mpB, -outcome.change, config);

  return players.map((p) => {
    if (p.id === match.p1.id) {
      return {
        ...p,
        mp: p.mp + outcome.mpA,
        perf: p.perf + outcome.perfA,
        perfCount: p.perfCount + 1,
        elo: p.elo + outcome.change,
        games: p.games + 1,
        opps: p.opps.includes(match.p2.id) ? p.opps : [...p.opps, match.p2.id],
        rp: p.rp + rp1,
        pointsFor: p.pointsFor + PA,
        pointsAgainst: p.pointsAgainst + PB,
        inningsTotal: p.inningsTotal + inn,
        npd: p.npd + outcome.npdA,
        hs: Math.max(p.hs, HRA),
        hgd: Math.max(p.hgd, outcome.gdA)
      };
    }
    if (p.id === match.p2.id) {
      return {
        ...p,
        mp: p.mp + outcome.mpB,
        perf: p.perf + outcome.perfB,
        perfCount: p.perfCount + 1,
        elo: p.elo - outcome.change,
        games: p.games + 1,
        opps: p.opps.includes(match.p1.id) ? p.opps : [...p.opps, match.p1.id],
        rp: p.rp + rp2,
        pointsFor: p.pointsFor + PB,
        pointsAgainst: p.pointsAgainst + PA,
        inningsTotal: p.inningsTotal + inn,
        npd: p.npd + outcome.npdB,
        hs: Math.max(p.hs, HRB),
        hgd: Math.max(p.hgd, outcome.gdB)
      };
    }
    return p;
  });
};

// recalculateTournamentPlayers({ players, roster, rounds, currentRound, config })
// -> new players array
//
// Pure: reads `players`/`roster`/`rounds`/`config` only, never mutates any
// of them, and returns a brand-new array/object graph. `rounds` is consumed
// read-only — this function has no way to write back to it, matching the
// hard product rule that recalculation never re-pairs.
export const recalculateTournamentPlayers = ({ players, roster, rounds, currentRound, config }) => {
  const startElos = {};
  roster.forEach((p) => { startElos[p.id] = p.elo; });

  let curr = players.map((p) => ({
    ...p,
    mp: 0,
    perf: 0,
    elo: startElos[p.id] || p.elo,
    games: 0,
    perfCount: 0,
    opps: [],
    rp: 0,
    racksWon: 0,
    racksLost: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    inningsTotal: 0,
    npd: 0,
    hs: 0,
    hgd: 0
  }));

  for (let round = 1; round <= currentRound; round++) {
    const roundMatches = rounds[round] || [];
    roundMatches.forEach((match) => {
      if (!match.done || match.cancelled) return;

      if (match.format === 'straight_pool_14_1' && !match.bye) {
        curr = applyStraightPoolMatch(curr, match, config);
        return;
      }

      curr = applyFixedRackMatch(curr, match, config, (mp, change) => calcRoundRP(mp, change, config));
    });
  }

  return curr;
};
